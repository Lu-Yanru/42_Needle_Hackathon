// The agent loop: a PLANNING -> IMPLEMENTING -> TESTING -> FIXING -> DONE
// state machine. PLANNING and IMPLEMENTING/FIXING are model-driven; TESTING is
// deterministic (the harness runs tests, no model call) so the small local
// model cannot drift or react to stale results.

import { z } from "zod";
import { MAX_INNER_STEPS, NO_IMPROVEMENT_LIMIT } from "./config";
import type { Logger } from "./logger";
import { type ChatMessage, chat, type OllamaTool } from "./ollama";
import * as prompts from "./prompts";
import { PlanSchema, type RunState } from "./state";
import { runPublicTests } from "./test-runner";
import { createTools, FINISH_PHASE, type ToolContext } from "./tools/index";
import type { AnyTool } from "./tools/types";
import { truncateHead } from "./truncate";
import { Workspace } from "./workspace";

function toOllamaTools(tools: AnyTool[]): OllamaTool[] {
  return tools.map((tool) => ({
    type: "function" as const,
    function: { name: tool.name, description: tool.description, parameters: tool.jsonSchema },
  }));
}

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

async function renderFiles(workspace: Workspace): Promise<string> {
  const files = await workspace.listFiles();
  if (files.length === 0) return "(workspace is empty)";
  const parts: string[] = [];
  for (const file of files.slice(0, 12)) {
    const content = await workspace.readFile(file);
    const t = truncateHead(content, { maxLines: 140, maxBytes: 6000 });
    parts.push(`### ${file}\n\`\`\`\n${t.content}\n\`\`\``);
  }
  if (files.length > 12) parts.push(`... and ${files.length - 12} more file(s)`);
  return parts.join("\n\n");
}

async function doPlanning(state: RunState, logger: Logger): Promise<void> {
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

  if (!res.error) {
    const parsed = PlanSchema.safeParse(safeJson(res.message.content));
    if (parsed.success) {
      state.plan = parsed.data;
      await logger.decision(
        "plan accepted",
        `run_command="${parsed.data.run_command}", ${parsed.data.steps.length} step(s)`,
        "IMPLEMENTING",
      );
      state.phase = "IMPLEMENTING";
      return;
    }
    state.planFailures++;
    await logger.error(
      "PLAN_PARSE",
      parsed.error.message.slice(0, 300),
      "no usable plan",
      `retry (attempt ${state.planFailures})`,
    );
  } else {
    state.planFailures++;
    await logger.error("LLM_ERROR", res.error, "no plan produced", `retry (attempt ${state.planFailures})`);
  }

  if (state.planFailures >= 3) {
    await logger.error("PLANNING_FAILED", "3 planning attempts failed", "cannot proceed", "aborting run");
    state.phase = "FAILED";
  }
}

async function doModelPhase(
  state: RunState,
  logger: Logger,
  systemPrompt: string,
  tools: AnyTool[],
  ollamaTools: OllamaTool[],
  workspace: Workspace,
): Promise<void> {
  if (!state.plan) {
    state.phase = "FAILED";
    return;
  }

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

  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt },
  ];

  let finished = false;
  let noToolTurns = 0;
  for (let step = 0; step < MAX_INNER_STEPS && !finished; step++) {
    const res = await chat({ messages, tools: ollamaTools });
    if (res.error) {
      await logger.error("LLM_ERROR", res.error, `${state.phase} step ${step}`, "ending phase, will test");
      break;
    }

    const assistant = res.message;
    messages.push(assistant);
    if (assistant.content.trim()) {
      await logger.decision(`${state.phase} reasoning`, assistant.content.trim().slice(0, 500));
    }

    const calls = assistant.tool_calls ?? [];
    if (calls.length === 0) {
      noToolTurns++;
      if (noToolTurns >= 2) break;
      messages.push({
        role: "user",
        content:
          "You did not call a tool. Use write_file / read_file / run_command to make progress, or call finish_phase when the code is ready to test.",
      });
      continue;
    }

    for (const call of calls) {
      const name = call.function.name;
      const tool = tools.find((t) => t.name === name);
      if (!tool) {
        messages.push({ role: "tool", tool_name: name, content: `Unknown tool: ${name}` });
        continue;
      }
      const result = await tool.run(call.function.arguments);
      messages.push({ role: "tool", tool_name: name, content: result.content });

      if (name === FINISH_PHASE) {
        await logger.decision("finish_phase", result.content, "TESTING");
        finished = true;
        break;
      }
      if (name === "write_file") {
        const path = (call.function.arguments as { path?: unknown }).path;
        await logger.decision("write_file", typeof path === "string" ? path : "(unknown path)");
      }
    }
  }

  state.phase = "TESTING";
}

async function doTesting(state: RunState, logger: Logger, workspace: Workspace): Promise<void> {
  const runCommand = state.plan?.run_command ?? "";
  if (!runCommand) {
    await logger.error("NO_RUN_COMMAND", "plan has no run_command", "cannot test", "moving to FIXING");
    state.phase = "FIXING";
    return;
  }

  const result = await runPublicTests({ workspaceDir: workspace.root, runCommand });
  state.lastTestResult = result;

  if (result.error && result.total === 0) {
    await logger.error("TEST_RUNNER", result.error, "no score this iteration", "moving to FIXING");
    state.phase = "FIXING";
    return;
  }

  await logger.testRun(result.score, result.total, result.failing_categories, runCommand);
  state.scoreProgression.push({
    ts: new Date().toISOString(),
    score: result.score,
    total: result.total,
  });

  if (result.total > 0 && result.score === result.total) {
    state.bestScore = result.score;
    await logger.decision("all tests passing", `${result.score}/${result.total}`, "DONE");
    state.phase = "DONE";
    return;
  }

  if (result.score > state.bestScore) {
    state.bestScore = result.score;
    state.noImprovementStreak = 0;
    state.lastGoodSnapshot = await workspace.snapshot();
    await logger.decision("score improved", `new best ${result.score}/${result.total}`, "FIXING");
  } else {
    state.noImprovementStreak++;
    if (result.score < state.bestScore && state.lastGoodSnapshot) {
      await workspace.restore(state.lastGoodSnapshot);
      await logger.decision(
        "rolled back regression",
        `score ${result.score} < best ${state.bestScore}; restored last-good workspace`,
        "FIXING",
      );
    }
  }
  state.phase = "FIXING";
}

export async function runAgent(state: RunState, logger: Logger): Promise<void> {
  const workspace = new Workspace(state.workspaceDir);
  const toolContext: ToolContext = {
    workspace,
    onCommand: (command, exitCode, summary) => {
      void logger.command(command, exitCode, summary);
    },
  };
  const tools = createTools(toolContext);
  const ollamaTools = toOllamaTools(tools);
  const systemPrompt = prompts.systemPrompt(tools);

  while (
    state.iteration < state.maxIterations &&
    state.phase !== "DONE" &&
    state.phase !== "FAILED"
  ) {
    if (state.phase === "PLANNING") {
      await doPlanning(state, logger);
    } else if (state.phase === "IMPLEMENTING" || state.phase === "FIXING") {
      await doModelPhase(state, logger, systemPrompt, tools, ollamaTools, workspace);
    } else if (state.phase === "TESTING") {
      await doTesting(state, logger, workspace);
    }

    state.iteration++;
    console.log(`iteration ${state.iteration}: phase -> ${state.phase}`);

    if (state.dryRun) {
      console.log("[dry-run] stopping after one phase");
      return;
    }
  }
}
