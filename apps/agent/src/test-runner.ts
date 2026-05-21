// Runs the public test suite and parses its score.
//
// NOTE: the exact runner CLI and output format are unknown until the hidden
// task is released at 20:00. Expect to patch findRunner() and parseTestOutput()
// once secret_spec/test_runner/README.md is available — that is a logged
// human intervention, not a failure.

import { join, resolve } from "node:path";
import type { TestResult } from "./state";

export interface TestRunnerConfig {
  workspaceDir: string;
  runCommand: string;
  runnerPath?: string;
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
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
  const scoreMatch = /(?:SCORE|Score|PASSED|Passed|RESULT)\s*[:=]?\s*(\d+)\s*\/\s*(\d+)/.exec(output);
  const score = scoreMatch ? Number(scoreMatch[1] ?? "0") : 0;
  const total = scoreMatch ? Number(scoreMatch[2] ?? "0") : 0;
  const failing = [...output.matchAll(/^\s*FAIL(?:ED)?\s*[:\-]?\s*(\S+)/gim)]
    .map((m) => m[1] ?? "")
    .filter(Boolean);
  return { score, total, failing_categories: [...new Set(failing)], raw: output };
}

export async function runPublicTests(config: TestRunnerConfig): Promise<TestResult> {
  const runner = config.runnerPath ?? (await findRunner(config.workspaceDir));
  if (!runner) {
    return {
      score: 0,
      total: 0,
      failing_categories: [],
      raw: "",
      error:
        "test runner not found (expected secret_spec/test_runner/run_tests.py). Patch test-runner.ts once the real runner is released.",
    };
  }

  const cmd = `python3 ${shellQuote(runner)} --program ${shellQuote(config.runCommand)} --suite public`;

  let stdout = "";
  let stderr = "";
  let exitCode = -1;
  let timedOut = false;
  try {
    const proc = Bun.spawn(["bash", "-lc", cmd], {
      cwd: resolve(config.workspaceDir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const timer = setTimeout(() => {
      timedOut = true;
      proc.kill();
    }, 180_000);
    try {
      [stdout, stderr, exitCode] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited.then((code) => code ?? -1),
      ]);
    } finally {
      clearTimeout(timer);
    }
  } catch (err) {
    return {
      score: 0,
      total: 0,
      failing_categories: [],
      raw: "",
      error: `failed to run test runner: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  if (timedOut) {
    return {
      score: 0,
      total: 0,
      failing_categories: [],
      raw: `${stdout}\n${stderr}`,
      error: "test runner timed out after 180s",
    };
  }

  const combined = stdout + (exitCode !== 0 ? `\n${stderr}` : "");
  const result = parseTestOutput(combined);
  if (result.total === 0 && exitCode !== 0) {
    result.error = `test runner exited with code ${exitCode}`;
  }
  return result;
}
