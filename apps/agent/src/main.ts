// CLI entrypoint for the agent harness.
//
//   bun run start --spec <path/to/SPEC.md> [--workspace ./solution]
//                 [--dry-run] [--max-iter N] [--log-dir <dir>] [--test-cmd "<cmd>"]
//
// The agent's run data (logs, run.jsonl, state.json, agent_manifest.json) is
// written to `<workspace>/.needle-agent/` unless --log-dir overrides it.

import { join, resolve } from "node:path";
import { MAX_ITERATIONS, MODEL, TEST_COMMAND } from "./config";
import { EventLog } from "./events";
import { Logger } from "./logger";
import { runAgent } from "./loop";
import { checkOllama } from "./ollama";
import type { RunState } from "./state";
import { buildFinalReport, writeManifest } from "./submission";

interface Args {
  spec: string;
  workspace: string;
  dryRun: boolean;
  maxIter: number;
  logDir: string;
  testCmd: string;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    spec: "",
    workspace: "./solution",
    dryRun: false,
    maxIter: MAX_ITERATIONS,
    logDir: "", // empty = default to <workspace>/.needle-agent
    testCmd: TEST_COMMAND,
  };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === "--spec") args.spec = argv[++i] ?? "";
    else if (flag === "--workspace") args.workspace = argv[++i] ?? args.workspace;
    else if (flag === "--dry-run") args.dryRun = true;
    else if (flag === "--max-iter") args.maxIter = Number(argv[++i] ?? args.maxIter);
    else if (flag === "--log-dir") args.logDir = argv[++i] ?? args.logDir;
    else if (flag === "--test-cmd") args.testCmd = argv[++i] ?? args.testCmd;
  }
  return args;
}

async function main(): Promise<number> {
  const args = parseArgs(Bun.argv.slice(2));
  if (!args.spec) {
    console.error(
      'usage: bun run start --spec <path/to/SPEC.md> [--workspace ./solution] [--dry-run] [--max-iter N] [--log-dir <dir>] [--test-cmd "<cmd>"]',
    );
    return 2;
  }

  const specFile = Bun.file(resolve(args.spec));
  if (!(await specFile.exists())) {
    console.error(`spec file not found: ${args.spec}`);
    return 2;
  }

  // Create the workspace up front so test-runner / run_command spawns have a
  // valid cwd. The agent's run data lives in .needle-agent/ at the workspace
  // root (override with --log-dir).
  const workspaceDir = resolve(args.workspace);
  await Bun.$`mkdir -p ${workspaceDir}`.quiet().nothrow();
  const outputDir = args.logDir ? resolve(args.logDir) : join(workspaceDir, ".needle-agent");

  const logger = await Logger.create(outputDir);
  const events = await EventLog.create(outputDir);

  const ollama = await checkOllama();
  if (ollama.isErr()) {
    console.error(`Ollama not ready: ${ollama.error.message}`);
    await logger.error(
      "OLLAMA_UNAVAILABLE",
      ollama.error.message,
      "cannot start the run",
      "fix Ollama / pull the model",
    );
    return 1;
  }
  console.log(ollama.value.detail);

  const state: RunState = {
    specPath: args.spec,
    spec: await specFile.text(),
    workspaceDir,
    phase: "PLANNING",
    plan: null,
    iteration: 0,
    maxIterations: args.maxIter,
    bestScore: -1,
    noImprovementStreak: 0,
    planFailures: 0,
    lastTestResult: null,
    lastGoodSnapshot: null,
    scoreProgression: [],
    selfTests: [],
    testCommand: args.testCmd,
    testSource: "none",
    dryRun: args.dryRun,
  };

  console.log(
    `agent: model=${MODEL} workspace=${workspaceDir} output=${outputDir} spec=${args.spec}`,
  );

  try {
    await runAgent(state, logger, events);
  } catch (err) {
    const detail = err instanceof Error ? (err.stack ?? err.message) : String(err);
    await logger.error("FATAL", detail, "run aborted", "see errors.log");
    await events.errorEvent("FATAL", detail.slice(0, 300));
    state.phase = "FAILED";
    await events.writeState(state);
  }

  await logger.writeFinalReport(buildFinalReport(state));
  await writeManifest(join(outputDir, "agent_manifest.json"));

  const tr = state.lastTestResult;
  console.log(
    `done: phase=${state.phase} score=${tr ? `${tr.score}/${tr.total}` : "n/a"} iterations=${state.iteration}`,
  );
  return state.phase === "DONE" ? 0 : 1;
}

process.exit(await main());
