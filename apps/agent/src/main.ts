// CLI entrypoint for the agent harness.
//
//   bun run start --spec <path/to/SPEC.md> [--workspace ./solution]
//                 [--dry-run] [--max-iter N] [--log-dir <dir>] [--test-cmd "<cmd>"]
//   bun run start --resume   (continue the last stopped run from checkpoint.json)
//
// The agent's run data (logs, run.jsonl, state.json, checkpoint.json,
// agent_manifest.json) is written to `<monorepo-root>/.needle-agent/` unless
// --log-dir overrides it.

import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { MAX_ITERATIONS, MODEL, TEST_COMMAND } from "./config";
import { EventLog } from "./events";
import { Logger } from "./logger";
import { runAgent } from "./loop";
import { checkModel } from "./openrouter";
import { loadCheckpoint } from "./checkpoint";
import type { RunState } from "./state";
import { buildFinalReport, writeManifest } from "./submission";

/** Walk up from this file to the monorepo root (the directory with turbo.json). */
function findRepoRoot(): string {
  let dir = import.meta.dir;
  for (let i = 0; i < 12; i++) {
    if (existsSync(join(dir, "turbo.json"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return resolve(import.meta.dir, "../../.."); // fallback: apps/<name>/src layout
}

interface Args {
  spec: string;
  workspace: string;
  dryRun: boolean;
  maxIter: number;
  logDir: string;
  testCmd: string;
  resume: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    spec: "",
    workspace: "./solution",
    dryRun: false,
    maxIter: MAX_ITERATIONS,
    logDir: "", // empty = default to <monorepo-root>/.needle-agent
    testCmd: TEST_COMMAND,
    resume: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === "--spec") args.spec = argv[++i] ?? "";
    else if (flag === "--workspace") args.workspace = argv[++i] ?? args.workspace;
    else if (flag === "--dry-run") args.dryRun = true;
    else if (flag === "--max-iter") args.maxIter = Number(argv[++i] ?? args.maxIter);
    else if (flag === "--log-dir") args.logDir = argv[++i] ?? args.logDir;
    else if (flag === "--test-cmd") args.testCmd = argv[++i] ?? args.testCmd;
    else if (flag === "--resume") args.resume = true;
  }
  return args;
}

async function main(): Promise<number> {
  const args = parseArgs(Bun.argv.slice(2));
  if (!args.spec && !args.resume) {
    console.error(
      "usage: bun run start --spec <path/to/SPEC.md> [--workspace ./solution] [--dry-run]\n" +
        '                    [--max-iter N] [--log-dir <dir>] [--test-cmd "<cmd>"] [--resume]',
    );
    return 2;
  }

  // The agent's run data lives in .needle-agent/ at the monorepo root
  // (override with --log-dir).
  const outputDir = args.logDir ? resolve(args.logDir) : join(findRepoRoot(), ".needle-agent");

  // Build the run state — fresh from the spec, or restored from a checkpoint
  // when --resume continues a stopped run.
  let state: RunState;
  if (args.resume) {
    const restored = await loadCheckpoint(outputDir);
    if (!restored) {
      console.error(`nothing to resume: no checkpoint.json under ${outputDir}`);
      return 2;
    }
    state = restored;
    console.log(`resuming run: phase=${state.phase} iteration=${state.iteration}`);
  } else {
    const specFile = Bun.file(resolve(args.spec));
    if (!(await specFile.exists())) {
      console.error(`spec file not found: ${args.spec}`);
      return 2;
    }
    state = {
      specPath: args.spec,
      spec: await specFile.text(),
      workspaceDir: resolve(args.workspace),
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
      verificationCommands: [],
      nextVerificationIndex: 0,
      lastRunState: null,
      dryRun: args.dryRun,
    };
  }

  // The workspace must exist before test-runner / run_command spawns need it.
  await Bun.$`mkdir -p ${state.workspaceDir}`.quiet().nothrow();

  const logger = await Logger.create(outputDir);
  const events = await EventLog.create(outputDir);

  const model = await checkModel();
  if (model.isErr()) {
    console.error(`OpenRouter not ready: ${model.error.message}`);
    await logger.error(
      "MODEL_UNAVAILABLE",
      model.error.message,
      "cannot start the run",
      "set OPENROUTER_API_KEY / check connectivity",
    );
    return 1;
  }
  console.log(model.value.detail);

  console.log(
    `agent: model=${MODEL} workspace=${state.workspaceDir} output=${outputDir} spec=${state.specPath}`,
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
