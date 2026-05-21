// The agent loop: a PLANNING -> IMPLEMENTING -> TESTING -> FIXING -> DONE
// state machine. PLANNING and IMPLEMENTING/FIXING are model-driven; TESTING is
// deterministic (the harness runs tests, no model call) so the small local
// model cannot drift or react to stale results.
//
// Model phases use Ollama's `format` (JSON-schema constrained output) to get
// one validated action per turn — qwen2.5-coder does not reliably emit native
// tool calls, so we never rely on `message.tool_calls`.

import { z } from "zod";
import { MAX_INNER_STEPS, MODEL, NO_IMPROVEMENT_LIMIT } from "./config";
import type { EventLog } from "./events";
import type { Logger } from "./logger";
import { type ChatMessage, chat, type Usage } from "./ollama";
import * as prompts from "./prompts";
import {
  type Action,
  ActionSchema,
  PlanSchema,
  type RunState,
  type SelfTest,
  SelfTestSchema,
  type TestResult,
} from "./state";
import { programBaseCommand, runSelfTests } from "./self-tests";
import { runPublicTests, smokeRun } from "./test-runner";
import { createTools, FINISH_PHASE, type ToolContext } from "./tools/index";
import type { AnyTool } from "./tools/types";
import { truncateHead } from "./truncate";
import { Workspace } from "./workspace";

/** Zero token usage — recorded when a model call fails before producing output. */
const NO_USAGE: Usage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };

/** Best-effort JSON extraction (handles fenced or prose-wrapped output). */
function safeJson(text: string): unknown {
  const tryParse = (value: string): unknown => {
    try {
      return JSON.parse(value);
    } catch {
      return undefined;
    }
  };
  const direct = tryParse(text);
  if (direct !== undefined) return direct;
  const fencedBody = /```(?:json)?\s*([\s\S]*?)```/.exec(text)?.[1];
  if (fencedBody) {
    const fenced = tryParse(fencedBody);
    if (fenced !== undefined) return fenced;
  }
  const open = text.indexOf("{");
  const close = text.lastIndexOf("}");
  if (open >= 0 && close > open) {
    const braced = tryParse(text.slice(open, close + 1));
    if (braced !== undefined) return braced;
  }
  return null;
}

/** Map a parsed Action to a tool name + argument object for the tool registry. */
function actionToToolArgs(action: Action): { name: string; args: Record<string, unknown> } {
  switch (action.tool) {
    case "read_file":
      return { name: "read_file", args: { path: action.path } };
    case "write_file":
      return { name: "write_file", args: { path: action.path, content: action.content } };
    case "list_dir":
      return { name: "list_dir", args: {} };
    case "run_command":
      return { name: "run_command", args: { command: action.command } };
    case "finish_phase":
      return { name: "finish_phase", args: { summary: action.summary } };
  }
}

async function renderFiles(workspace: Workspace): Promise<string> {
  const listed = await workspace.listFiles();
  const files = listed.unwrapOr([]);
  if (files.length === 0) return "(workspace is empty)";
  const parts: string[] = [];
  for (const file of files.slice(0, 12)) {
    const content = (await workspace.readFile(file)).unwrapOr("");
    const t = truncateHead(content, { maxLines: 140, maxBytes: 6000 });
    parts.push(`### ${file}\n\`\`\`\n${t.content}\n\`\`\``);
  }
  if (files.length > 12) parts.push(`... and ${files.length - 12} more file(s)`);
  return parts.join("\n\n");
}

async function doPlanning(state: RunState, logger: Logger, events: EventLog): Promise<void> {
  await events.emit("phase_start", { phase: "PLANNING", iteration: state.iteration });
  const prompt = prompts.planningPrompt(state.spec);
  await logger.prompt("PLANNING", prompt);

  const res = await chat({
    messages: [
      {
        role: "system",
        content: "You are a planning assistant. Respond only with the requested JSON object.",
      },
      { role: "user", content: prompt },
    ],
    format: z.toJSONSchema(PlanSchema),
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
  const parsed = PlanSchema.safeParse(safeJson(chatResult.message.content));
  if (parsed.success) {
    state.plan = parsed.data;
    await logger.decision(
      "plan accepted",
      `run_command="${parsed.data.run_command}", ${parsed.data.steps.length} step(s)`,
      "GENERATE_TESTS",
    );
    await events.emit("plan", {
      runCommand: parsed.data.run_command,
      entrypoint: parsed.data.entrypoint,
      steps: parsed.data.steps.length,
    });
    state.phase = "GENERATE_TESTS";
    return;
  }

  state.planFailures++;
  await logger.error(
    "PLAN_PARSE",
    parsed.error.message.slice(0, 300),
    "no usable plan",
    `retry (attempt ${state.planFailures})`,
  );
  await events.errorEvent("PLAN_PARSE", parsed.error.message.slice(0, 200));

  if (state.planFailures >= 3) {
    await logger.error("PLANNING_FAILED", "3 planning attempts failed", "cannot proceed", "aborting run");
    state.phase = "FAILED";
  }
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

  // Generate one flat test per call. Ollama's constrained decoding is far
  // slower on nested schemas, so a per-test loop stays fast and reliable
  // where a single whole-suite call times out.
  const target = 6;
  const testFormat = z.toJSONSchema(SelfTestSchema);
  const tests: SelfTest[] = [];

  for (let i = 0; i < target; i++) {
    const prompt = prompts.generateTestPrompt(state.spec, state.plan, tests);
    if (i === 0) await logger.prompt("GENERATE_TESTS", prompt);

    const res = await chat({
      messages: [
        {
          role: "system",
          content:
            "You write one test case for a program from its specification. Every expected value must be derived from the SPECIFICATION, never by running a program. Respond only with the requested JSON object.",
        },
        { role: "user", content: prompt },
      ],
      format: testFormat,
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
    const parsed = SelfTestSchema.safeParse(safeJson(chatResult.message.content));
    if (parsed.success) {
      tests.push(parsed.data);
    } else {
      await logger.error(
        "SELFTEST_PARSE",
        parsed.error.message.slice(0, 200),
        `self-test ${i + 1}/${target}`,
        "skipping this case",
      );
      await events.errorEvent("SELFTEST_PARSE", parsed.error.message.slice(0, 150));
    }
  }

  state.selfTests = tests;
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

  const files = await renderFiles(workspace);
  let userPrompt: string;
  if (state.phase === "IMPLEMENTING") {
    userPrompt = prompts.implementingPrompt(state.plan, files);
  } else {
    const tr = state.lastTestResult;
    if (!tr) {
      state.phase = "TESTING";
      return;
    }
    userPrompt =
      state.noImprovementStreak >= NO_IMPROVEMENT_LIMIT
        ? prompts.stuckPrompt(state.plan, tr, files)
        : prompts.fixingPrompt(state.plan, tr, files);
  }
  await logger.prompt(state.phase, userPrompt);

  const actionFormat = z.toJSONSchema(ActionSchema);
  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt },
  ];

  let finished = false;
  for (let step = 0; step < MAX_INNER_STEPS && !finished; step++) {
    const res = await chat({ messages, format: actionFormat });
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

    const parsed = ActionSchema.safeParse(safeJson(chatResult.message.content));
    if (!parsed.success) {
      await logger.error(
        "ACTION_PARSE",
        parsed.error.message.slice(0, 200),
        `${state.phase} step ${step}`,
        "asking model to retry",
      );
      await events.errorEvent("ACTION_PARSE", parsed.error.message.slice(0, 150));
      messages.push({ role: "assistant", content: chatResult.message.content });
      messages.push({
        role: "user",
        content: "Your response was not a valid action JSON object. Respond with exactly one action object.",
      });
      continue;
    }

    const action = parsed.data;
    messages.push({ role: "assistant", content: chatResult.message.content });
    await logger.decision(`${state.phase} action: ${action.tool}`, action.reasoning);

    const { name, args } = actionToToolArgs(action);
    const tool = tools.find((t) => t.name === name);
    if (!tool) {
      messages.push({ role: "user", content: `Unknown tool: ${name}` });
      continue;
    }
    const result = await tool.run(args);
    await events.toolCall(name, !result.isError, result.content.slice(0, 140));

    if (name === FINISH_PHASE) {
      await logger.decision("finish_phase", result.content, "TESTING");
      finished = true;
      break;
    }
    messages.push({ role: "user", content: `Result of ${name}:\n${result.content}` });
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
    await logger.decision("all tests passing", `${result.score}/${result.total}`, "DONE");
    await events.emit("done", { score: result.score, total: result.total });
    state.phase = "DONE";
    return;
  }

  if (result.score > state.bestScore) {
    state.bestScore = result.score;
    state.noImprovementStreak = 0;
    state.lastGoodSnapshot = (await workspace.snapshot()).unwrapOr(null);
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
