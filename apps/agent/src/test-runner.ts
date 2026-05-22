// Runs the public test suite and parses its score, and provides a "smoke run"
// that executes the program directly so failures surface a real diagnostic.
//
// NOTE: the exact runner CLI and output format are unknown until the hidden
// task is released at 20:00. Expect to patch findRunner() and parseTestOutput()
// once secret_spec/test_runner/README.md is available — that is a logged
// human intervention, not a failure.

import { join, resolve } from "node:path";
import { Result } from "better-result";
import { ProcessError } from "./errors";
import type { TestResult } from "./state";
import { truncateTail } from "./truncate";

export interface TestRunnerConfig {
  workspaceDir: string;
  runCommand: string;
  runnerPath?: string;
  /** Configured official test command; "{program}" is replaced with runCommand. */
  testCommand?: string;
}

interface SpawnResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  timedOut: boolean;
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

async function spawnCapture(
  cmd: string,
  cwd: string,
  timeoutMs: number,
): Promise<Result<SpawnResult, ProcessError>> {
  return Result.tryPromise({
    try: async () => {
      let stdout = "";
      let stderr = "";
      let exitCode = -1;
      let timedOut = false;
      const proc = Bun.spawn(["bash", "-lc", cmd], {
        cwd,
        stdout: "pipe",
        stderr: "pipe",
      });
      const timer = setTimeout(() => {
        timedOut = true;
        proc.kill();
      }, timeoutMs);
      try {
        [stdout, stderr, exitCode] = await Promise.all([
          new Response(proc.stdout).text(),
          new Response(proc.stderr).text(),
          proc.exited.then((code) => code ?? -1),
        ]);
      } finally {
        clearTimeout(timer);
      }
      return { stdout, stderr, exitCode, timedOut } satisfies SpawnResult;
    },
    catch: (cause) => new ProcessError({ command: cmd, cause }),
  });
}

async function findRunner(workspaceDir: string): Promise<string | null> {
  const candidates = [
    "secret_spec/test_runner/run_tests.py",
    "secret_spec/public_tests/run_tests.py",
    join(workspaceDir, "secret_spec/test_runner/run_tests.py"),
    "toy_spec/test_runner/run_tests.py",
    join(workspaceDir, "toy_spec/test_runner/run_tests.py"),
  ];
  for (const candidate of candidates) {
    const abs = resolve(candidate);
    if (await Bun.file(abs).exists()) return abs;
  }
  return null;
}

export function parseTestOutput(output: string): TestResult {
  // The official runner (secret_spec/test_runner/run_tests.py) prints a
  // scoreboard whose "Overall [bar] N/M passed" line carries the score. Fall
  // back to a generic "Score: N/M" for any other runner.
  const match =
    /Overall\s+\[[^\]]*\]\s+(\d+)\s*\/\s*(\d+)\s+passed/.exec(output) ??
    /(?:SCORE|Score|RESULT)\s*[:=]?\s*(\d+)\s*\/\s*(\d+)/.exec(output);
  const score = match ? Number(match[1]) : 0;
  const total = match ? Number(match[2]) : 0;

  // The runner prints one "level_NN_name [bar] passed/total" line per level;
  // a level counts as failing when passed < total.
  const failing: string[] = [];
  for (const m of output.matchAll(
    /^\s*(level_\S+)\s+\[[^\]]*\]\s+(\d+)\s*\/\s*(\d+)\s*$/gim,
  )) {
    const name = m[1] ?? "";
    if (name && Number(m[2]) < Number(m[3])) failing.push(name);
  }

  return {
    score,
    total,
    failing_categories: [...new Set(failing)],
    raw: output,
  };
}

export async function runPublicTests(
  config: TestRunnerConfig,
): Promise<TestResult> {
  let cmd: string;
  const configured = config.testCommand?.trim();
  if (configured) {
    cmd = configured.includes("{program}")
      ? configured.replaceAll("{program}", config.runCommand)
      : configured;
  } else {
    const runner = config.runnerPath ?? (await findRunner(config.workspaceDir));
    if (!runner) {
      return {
        score: 0,
        total: 0,
        failing_categories: [],
        raw: "",
        error:
          "no official test runner (set --test-cmd / AGENT_TEST_CMD, or place run_tests.py under secret_spec/)",
      };
    }
    cmd = `python3 ${shellQuote(runner)} --program ${shellQuote(config.runCommand)} --suite public`;
  }
  const spawned = await spawnCapture(cmd, resolve(config.workspaceDir), 180_000);

  if (spawned.isErr()) {
    return {
      score: 0,
      total: 0,
      failing_categories: [],
      raw: "",
      error: `failed to run test runner: ${spawned.error.message}`,
    };
  }
  const res = spawned.value;
  if (res.timedOut) {
    return {
      score: 0,
      total: 0,
      failing_categories: [],
      raw: `${res.stdout}\n${res.stderr}`,
      error: "test runner timed out after 180s",
    };
  }

  const combined = res.stdout + (res.exitCode !== 0 ? `\n${res.stderr}` : "");
  const result = parseTestOutput(combined);
  if (result.total === 0 && res.exitCode !== 0) {
    result.error = `test runner exited with code ${res.exitCode}`;
  }
  return result;
}

/**
 * Run the program directly (no stdin) and capture stdout/stderr/exit code.
 * A failing test suite only reports a score; this surfaces the real error —
 * syntax errors, tracebacks — so the FIXING phase has something to act on.
 */
export async function smokeRun(
  workspaceDir: string,
  runCommand: string,
): Promise<string> {
  const spawned = await spawnCapture(
    `${runCommand} </dev/null`,
    resolve(workspaceDir),
    15_000,
  );
  if (spawned.isErr()) return `could not run the program: ${spawned.error.message}`;
  const res = spawned.value;
  if (res.timedOut)
    return "program timed out after 15s (it may be waiting on input)";
  const body = [
    `exit code: ${res.exitCode}`,
    res.stdout ? `stdout:\n${res.stdout}` : "stdout: (empty)",
    res.stderr ? `stderr:\n${res.stderr}` : "stderr: (empty)",
  ].join("\n");
  return truncateTail(body, { maxLines: 60, maxBytes: 4000 }).content;
}
