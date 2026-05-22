// The agent loop: a PLANNING -> IMPLEMENTING -> TESTING -> FIXING -> DONE
// state machine. PLANNING and IMPLEMENTING/FIXING are model-driven; TESTING is
// deterministic (the harness runs tests, no model call) so the small local
// model cannot drift or react to stale results.
//
// Model phases use schema-constrained structured output (the AI SDK's
// generateObject) to get exactly one validated action per turn.

import { resolve } from "node:path";
import { MAX_INNER_STEPS, MODEL, NO_IMPROVEMENT_LIMIT } from "./config";
import type { EventLog } from "./events";
import type { Logger } from "./logger";
import { type ChatMessage, generateStructured, type Usage } from "./openrouter";
import { writeCheckpoint } from "./checkpoint";
import * as prompts from "./prompts";
import {
  compactFailureSignal,
  deriveVerificationCommands,
  isUniqueSelfTest,
  normalizePlan,
  renderWorkspacePreview,
  shouldStopRepeatedRunCommand,
} from "./harness-helpers";
import {
  type Action,
  ActionSchema,
  PlanSchema,
  type RunState,
  type SelfTest,
  SelfTestSchema,
  type TestResult,
} from "./state";
import { deriveSpecSelfTests, programBaseCommand, runSelfTests } from "./self-tests";
import { runPublicTests, smokeRun } from "./test-runner";
import { createTools, FINISH_PHASE, type ToolContext } from "./tools/index";
import type { AnyTool } from "./tools/types";
import { truncateHead } from "./truncate";
import { Workspace } from "./workspace";
import { drainOperatorPrompts } from "./operator";

/** Zero token usage — recorded when a model call fails before producing output. */
const NO_USAGE: Usage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };

function actionToToolArgs(action: Action): { name: string; args: Record<string, unknown> } {
  switch (action.tool) {
    case "read_file":
      return { name: "read_file", args: { path: action.path } };
    case "write_file":
      return { name: "write_file", args: { path: action.path, content: action.content } };
    case "edit_file":
      return {
        name: "edit_file",
        args: {
          path: action.path,
          search: action.search,
          replace: action.replace,
          replace_all: action.replace_all,
        },
      };
    case "list_dir":
      return { name: "list_dir", args: {} };
    case "run_command":
      return { name: "run_command", args: { command: action.command } };
    case "finish_phase":
      return { name: "finish_phase", args: { summary: action.summary } };
  }
}

function nextVerificationCommand(state: RunState): string | null {
  if (state.verificationCommands.length === 0) return null;
  const index = state.nextVerificationIndex % state.verificationCommands.length;
  const command = state.verificationCommands[index] ?? null;
  state.nextVerificationIndex = (index + 1) % state.verificationCommands.length;
  return command;
}

async function runVerificationAnchor(
  state: RunState,
  tools: AnyTool[],
  events: EventLog,
  command: string,
): Promise<{ content: string; shouldStop: boolean }> {
  const tool = tools.find((candidate) => candidate.name === "run_command");
  if (!tool) return { content: "Automatic verification unavailable: run_command tool missing", shouldStop: false };

  const result = await tool.run({ command, timeout_seconds: 15 });
  await events.toolCall("auto_verify", !result.isError, result.content.slice(0, 140));

  const repetition = shouldStopRepeatedRunCommand(state.lastRunState, command, result.content);
  state.lastRunState = repetition.nextState;
  return {
    content: `Automatic verification (${command}):\n${result.content}`,
    shouldStop: repetition.shouldStop,
  };
}

async function renderFiles(workspace: Workspace, entrypoint: string | null): Promise<string> {
  const listed = await workspace.listFiles();
  const files: string[] = listed.unwrapOr([]);
  if (files.length === 0) return "(workspace is empty)";

  const contents = new Map<string, string>();
  if (entrypoint && files.includes(entrypoint)) {
    const content = (await workspace.readFile(entrypoint)).unwrapOr("");
    const t = truncateHead(content, { maxLines: 140, maxBytes: 6000 });
    contents.set(entrypoint, t.content);
  }
  return renderWorkspacePreview(files, contents, entrypoint);
}

async function renderOperatorReferenceFiles(
  workspace: Workspace,
  refs: string[],
): Promise<string> {
  if (refs.length === 0) return "";

  const blocks: string[] = [];
  for (const ref of refs) {
    const resolved = ref.startsWith("/") ? ref : resolve(workspace.root, ref);
    const file = Bun.file(resolved);
    if (!(await file.exists())) {
      blocks.push(`FILE REF: ${ref}\n(unavailable: file not found at ${resolved})`);
      continue;
    }
    const raw = await file.text().catch(() => "");
    const truncated = truncateHead(raw, { maxLines: 120, maxBytes: 8000 });
    blocks.push(
      `FILE REF: ${ref}\n\`\`\`\n${truncated.content || "(empty file)"}\n\`\`\`${truncated.truncated ? "\n(truncated)" : ""}`,
    );
  }

  return blocks.join("\n\n");
}

async function doPlanning(state: RunState, logger: Logger, events: EventLog): Promise<void> {
  await events.emit("phase_start", { phase: "PLANNING", iteration: state.iteration });
  const prompt = prompts.planningPrompt(state.spec);
  await logger.prompt("PLANNING", prompt);

  const res = await generateStructured({
    messages: [
      {
        role: "system",
        content: "You are a planning assistant. Respond only with the requested JSON object.",
      },
      { role: "user", content: prompt },
    ],
    schema: PlanSchema,
    schemaName: "plan",
  });

  if (res.isErr()) {
    await events.modelCall("PLANNING", 0, NO_USAGE, 0);
    state.planFailures++;
    await logger.error(
      "LLM_ERROR",
      res.error.message,
      "no plan produced",
      `retry (attempt ${state.planFailures})`,
    );
    await events.errorEvent("LLM_ERROR", res.error.message);
    if (state.planFailures >= 3) {
      await logger.error(
        "PLANNING_FAILED",
        "3 planning attempts failed",
        "cannot proceed",
        "aborting run",
      );
      state.phase = "FAILED";
    }
    return;
  }

  const chatResult = res.value;
  await events.modelCall("PLANNING", chatResult.durationMs, chatResult.usage, 0);
  state.plan = normalizePlan(chatResult.object);
  await logger.decision(
    "plan accepted",
    `run_command="${state.plan.run_command}", ${state.plan.steps.length} step(s)`,
    "GENERATE_TESTS",
  );
  await events.emit("plan", {
    runCommand: state.plan.run_command,
    entrypoint: state.plan.entrypoint,
    steps: state.plan.steps.length,
  });
  state.phase = "GENERATE_TESTS";
}

async function doGenerateTests(
  state: RunState,
  logger: Logger,
  events: EventLog,
): Promise<void> {
  await events.emit("phase_start", { phase: "GENERATE_TESTS", iteration: state.iteration });
  if (!state.plan) {
    state.phase = "IMPLEMENTING";
    return;
  }

  // Generate one flat test per call — a per-test loop lets each new case be
  // deduplicated against the ones already accepted.
  const target = 4;
  const tests: SelfTest[] = deriveSpecSelfTests(state.spec, state.plan);

  if (tests.length > 0) {
    await logger.decision(
      "seeded self-tests from spec examples",
      `${tests.length} deterministic case(s): ${tests.map((t) => t.name).join(", ")}`,
    );
    await events.emit("self_tests_seeded", { count: tests.length });
  }

  for (let i = tests.length; i < target; i++) {
    const prompt = prompts.generateTestPrompt(state.spec, state.plan, tests);
    if (i === tests.length) await logger.prompt("GENERATE_TESTS", prompt);

    const res = await generateStructured({
      messages: [
        {
          role: "system",
          content:
            "You write one test case for a program from its specification. Every expected value must be derived from the SPECIFICATION, never by running a program. Respond only with the requested JSON object.",
        },
        { role: "user", content: prompt },
      ],
      schema: SelfTestSchema,
      schemaName: "self_test",
    });

    if (res.isErr()) {
      await events.modelCall("GENERATE_TESTS", 0, NO_USAGE, 0);
      await logger.error(
        "LLM_ERROR",
        res.error.message,
        `self-test ${i + 1}/${target}`,
        "stopping self-test generation",
      );
      await events.errorEvent("LLM_ERROR", res.error.message);
      break;
    }

    const chatResult = res.value;
    await events.modelCall("GENERATE_TESTS", chatResult.durationMs, chatResult.usage, 0);
    const test = chatResult.object;
    if (isUniqueSelfTest(tests, test)) {
      tests.push(test);
    } else {
      await logger.error(
        "SELFTEST_DUPLICATE",
        `${test.rule} :: ${test.args}`,
        `self-test ${i + 1}/${target}`,
        "skipping duplicate case",
      );
      await events.errorEvent("SELFTEST_DUPLICATE", test.rule.slice(0, 150));
    }
  }

  state.selfTests = tests;
  state.verificationCommands = deriveVerificationCommands(programBaseCommand(state.plan.run_command), tests);
  state.nextVerificationIndex = 0;
  if (tests.length > 0) {
    await logger.decision(
      "self-tests generated",
      `${tests.length} spec-derived case(s): ${tests.map((t) => t.name).join(", ")}`,
      "IMPLEMENTING",
    );
    await events.emit("self_tests", { count: tests.length });
  } else {
    await logger.error(
      "NO_SELFTESTS",
      "self-test generation produced 0 cases",
      "no fallback feedback signal",
      "continuing — the official runner may still be available",
    );
    await events.errorEvent("NO_SELFTESTS", "0 self-tests generated");
  }
  state.phase = "IMPLEMENTING";
}

async function doModelPhase(
  state: RunState,
  logger: Logger,
  events: EventLog,
  systemPrompt: string,
  tools: AnyTool[],
  workspace: Workspace,
): Promise<void> {
  if (!state.plan) {
    state.phase = "FAILED";
    return;
  }
  await events.emit("phase_start", { phase: state.phase, iteration: state.iteration });

  const files = await renderFiles(workspace, state.plan.entrypoint);
  const operatorPrompts = await drainOperatorPrompts(logger.dir);
  const operatorBlocks: string[] = [];
  for (const prompt of operatorPrompts) {
    const renderedRefs = await renderOperatorReferenceFiles(workspace, prompt.refs);
    operatorBlocks.push(
      `${operatorBlocks.length + 1}. ${prompt.text}${renderedRefs ? `\n\n${renderedRefs}` : ""}`,
    );
    await logger.prompt("OPERATOR", prompt.text);
    if (prompt.intervention) {
      await logger.humanIntervention(
        `Operator prompt queued for next model turn.\nPrompt: ${prompt.text}\nReference files: ${prompt.refs.length > 0 ? prompt.refs.join(", ") : "(none)"}\nTouched final task code: NO`,
      );
    }
    await events.emit("operator_prompt", {
      phase: state.phase,
      text: prompt.text.slice(0, 200),
      intervention: prompt.intervention,
      refs: prompt.refs,
    });
  }
  const operatorSection =
    operatorBlocks.length === 0
      ? ""
      : `\n\nOPERATOR NUDGES\n${operatorBlocks.join("\n\n")}\nTreat these as high-priority instructions unless they conflict with the specification.\n`;
  let userPrompt: string;
  if (state.phase === "IMPLEMENTING") {
    userPrompt = prompts.implementingPrompt(state.plan, files, state.verificationCommands);
  } else {
    const tr = state.lastTestResult;
    if (!tr) {
      state.phase = "TESTING";
      return;
    }
    const failureSignal = compactFailureSignal(tr);
    userPrompt =
      state.noImprovementStreak >= NO_IMPROVEMENT_LIMIT
        ? prompts.stuckPrompt(state.plan, failureSignal, files, state.verificationCommands)
        : prompts.fixingPrompt(state.plan, failureSignal, files, state.verificationCommands);
  }
  userPrompt += operatorSection;
  await logger.prompt(state.phase, userPrompt);

  const baseMessages: ChatMessage[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt },
  ];
  let followupMessages: ChatMessage[] = [];

  let finished = false;
  for (let step = 0; step < MAX_INNER_STEPS && !finished; step++) {
    const res = await generateStructured({
      messages: [...baseMessages, ...followupMessages],
      schema: ActionSchema,
      schemaName: "action",
    });
    if (res.isErr()) {
      await logger.error(
        "LLM_ERROR",
        res.error.message,
        `${state.phase} step ${step}`,
        "ending phase, will test",
      );
      await events.errorEvent("LLM_ERROR", res.error.message);
      break;
    }
    const chatResult = res.value;
    await events.modelCall(state.phase, chatResult.durationMs, chatResult.usage, 1);

    const action = chatResult.object;
    followupMessages = [{ role: "assistant", content: JSON.stringify(action) }];
    await logger.decision(`${state.phase} action: ${action.tool}`, action.reasoning);

    const { name, args } = actionToToolArgs(action);
    const tool = tools.find((t) => t.name === name);
    if (!tool) {
      followupMessages.push({
        role: "user",
        content: `Unknown tool: ${name}`,
      });
      continue;
    }
    const result = await tool.run(args);
    await events.toolCall(name, !result.isError, result.content.slice(0, 140));

    if (name === FINISH_PHASE) {
      await logger.decision("finish_phase", result.content, "TESTING");
      finished = true;
      break;
    }
    if ((name === "write_file" || name === "edit_file") && !result.isError) {
      const command = nextVerificationCommand(state);
      if (command) {
        const autoVerify = await runVerificationAnchor(state, tools, events, command);
        if (autoVerify.shouldStop) {
          await logger.decision(
            "stop repeated verification",
            "the same deterministic verification command produced the same failure twice; ending the phase to avoid thrashing",
            "TESTING",
          );
          followupMessages.push({
            role: "user",
            content: `Result of ${name}:\n${result.content}\n\n${autoVerify.content}`,
          });
          break;
        }
        followupMessages.push({
          role: "user",
          content: `Result of ${name}:\n${result.content}\n\n${autoVerify.content}`,
        });
        continue;
      }
    }
    if (name === "run_command") {
      const command = typeof args.command === "string" ? args.command : "";
      const repetition = shouldStopRepeatedRunCommand(state.lastRunState, command, result.content);
      state.lastRunState = repetition.nextState;
      if (repetition.shouldStop) {
        await logger.decision(
          "stop repeated run_command",
          "the same command produced the same failure twice; ending the phase to avoid thrashing",
          "TESTING",
        );
        break;
      }
    }
    followupMessages.push({ role: "user", content: `Result of ${name}:\n${result.content}` });
  }

  state.phase = "TESTING";
}

async function doTesting(
  state: RunState,
  logger: Logger,
  events: EventLog,
  workspace: Workspace,
): Promise<void> {
  await events.emit("phase_start", { phase: "TESTING", iteration: state.iteration });

  const runCommand = state.plan?.run_command ?? "";
  if (!runCommand) {
    await logger.error("NO_RUN_COMMAND", "plan has no run_command", "cannot test", "aborting run");
    await events.errorEvent("NO_RUN_COMMAND", "plan has no run_command");
    state.phase = "FAILED";
    return;
  }

  // Primary feedback: the official runner. Fall back to spec-derived
  // self-tests when no official runner is configured or found.
  const official = await runPublicTests({
    workspaceDir: workspace.root,
    runCommand,
    testCommand: state.testCommand,
  });

  let result: TestResult;
  if (!(official.error && official.total === 0)) {
    result = official;
    state.testSource = "official";
  } else if (state.selfTests.length > 0) {
    result = await runSelfTests({
      tests: state.selfTests,
      programFiles: (await workspace.snapshot()).unwrapOr(new Map()),
      baseCommand: programBaseCommand(runCommand),
    });
    state.testSource = "self";
  } else {
    await logger.error(
      "NO_TEST_SOURCE",
      official.error ?? "no official runner and no self-tests",
      "cannot evaluate the program",
      "aborting run",
    );
    await events.errorEvent("NO_TEST_SOURCE", official.error ?? "no test source");
    state.phase = "FAILED";
    return;
  }
  state.lastTestResult = result;

  const fullPass = result.total > 0 && result.score === result.total;

  // Tests did not fully pass — run the program directly so FIXING sees the
  // real error (syntax errors, tracebacks), not just a bare score.
  if (!fullPass) {
    const smoke = await smokeRun(workspace.root, runCommand);
    result.raw += `\n\n--- PROGRAM SMOKE RUN (${runCommand}, no stdin) ---\n${smoke}`;
  }

  await logger.testRun(
    result.score,
    result.total,
    result.failing_categories,
    state.testSource === "self" ? "spec-derived self-tests" : "official public tests",
  );
  await events.emit("test_run", {
    score: result.score,
    total: result.total,
    failing: result.failing_categories,
    source: state.testSource,
  });
  state.scoreProgression.push({
    ts: new Date().toISOString(),
    score: result.score,
    total: result.total,
  });

  if (fullPass) {
    state.bestScore = result.score;
    state.lastRunState = null;
    await logger.decision("all tests passing", `${result.score}/${result.total}`, "DONE");
    await events.emit("done", { score: result.score, total: result.total });
    state.phase = "DONE";
    return;
  }

  if (result.score > state.bestScore) {
    state.bestScore = result.score;
    state.noImprovementStreak = 0;
    state.lastGoodSnapshot = (await workspace.snapshot()).unwrapOr(null);
    state.lastRunState = null;
    await logger.decision("score improved", `new best ${result.score}/${result.total}`, "FIXING");
    await events.emit("score_improved", {
      score: result.score,
      total: result.total,
      bestScore: state.bestScore,
    });
  } else {
    state.noImprovementStreak++;
    if (result.score < state.bestScore && state.lastGoodSnapshot) {
      const restored = await workspace.restore(state.lastGoodSnapshot);
      if (restored.isErr()) {
        await logger.error(
          "ROLLBACK_FAILED",
          restored.error.message,
          "could not restore last-good workspace",
          "continuing with current files",
        );
        await events.errorEvent("ROLLBACK_FAILED", restored.error.message);
      }
      await logger.decision(
        "rolled back regression",
        `score ${result.score} < best ${state.bestScore}; restored last-good workspace`,
        "FIXING",
      );
      await events.emit("rollback", { score: result.score, bestScore: state.bestScore });
    }
  }
  state.phase = "FIXING";
}

export async function runAgent(state: RunState, logger: Logger, events: EventLog): Promise<void> {
  const workspace = new Workspace(state.workspaceDir);
  const toolContext: ToolContext = {
    workspace,
    onCommand: (command, exitCode, summary) => {
      void logger.command(command, exitCode, summary);
    },
  };
  const tools = createTools(toolContext);
  const systemPrompt = prompts.systemPrompt(tools);

  await events.emit("run_start", {
    model: MODEL,
    spec: state.specPath,
    workspace: state.workspaceDir,
    maxIterations: state.maxIterations,
  });
  await events.writeState(state);
  await writeCheckpoint(events.dir, state);

  while (
    state.iteration < state.maxIterations &&
    state.phase !== "DONE" &&
    state.phase !== "FAILED"
  ) {
    if (state.phase === "PLANNING") {
      await doPlanning(state, logger, events);
    } else if (state.phase === "GENERATE_TESTS") {
      await doGenerateTests(state, logger, events);
    } else if (state.phase === "IMPLEMENTING" || state.phase === "FIXING") {
      await doModelPhase(state, logger, events, systemPrompt, tools, workspace);
    } else if (state.phase === "TESTING") {
      await doTesting(state, logger, events, workspace);
    }

    state.iteration++;
    await events.writeState(state);
    await writeCheckpoint(events.dir, state);
    console.log(`iteration ${state.iteration}: phase -> ${state.phase}`);

    if (state.dryRun) {
      console.log("[dry-run] stopping after one phase");
      await events.emit("dry_run_stop", { phase: state.phase });
      return;
    }
  }

  await events.emit("run_end", {
    phase: state.phase,
    bestScore: state.bestScore,
    score: state.lastTestResult?.score ?? null,
    total: state.lastTestResult?.total ?? null,
    iterations: state.iteration,
  });
  await events.writeState(state);
}
