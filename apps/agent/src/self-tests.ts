// Spec-derived self-tests: the agent's feedback loop when no official public
// test runner is present (pre-reveal practice), and a hardening layer once it
// is. Expected values come from the SPECIFICATION — never by running the
// program — so a self-test cannot rubber-stamp the program against itself.

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Result } from "better-result";
import { ProcessError } from "./errors";
import type { SelfTest, TestResult } from "./state";

/**
 * Strip a trailing `<placeholder>` argument from a run command, leaving just
 * the program invocation: "python3 solution.py <input_file>" -> "python3 solution.py".
 */
export function programBaseCommand(runCommand: string): string {
  const tokens = runCommand.trim().split(/\s+/).filter(Boolean);
  while (tokens.length > 1 && /^<.*>$/.test(tokens[tokens.length - 1] ?? "")) {
    tokens.pop();
  }
  return tokens.join(" ");
}

/** Recursively sort object keys so two JSON values can be compared canonically. */
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    const source = value as Record<string, unknown>;
    for (const key of Object.keys(source).sort()) out[key] = canonicalize(source[key]);
    return out;
  }
  return value;
}

/** True when both strings parse as JSON and are structurally equal (key order
 *  and whitespace ignored; array order preserved). */
export function jsonEqual(a: string, b: string): boolean {
  let pa: unknown;
  let pb: unknown;
  try {
    pa = JSON.parse(a);
    pb = JSON.parse(b);
  } catch {
    return false;
  }
  return JSON.stringify(canonicalize(pa)) === JSON.stringify(canonicalize(pb));
}

export interface Expectation {
  expectedStdout?: string;
  expectedExitCode?: number;
}

export interface ActualOutput {
  stdout: string;
  exitCode: number;
}

/** Check a program's actual output against a self-test's expectations. */
export function checkSelfTest(
  expected: Expectation,
  actual: ActualOutput,
): { passed: boolean; reason: string } {
  const hasStdout = expected.expectedStdout !== undefined;
  const hasExit = expected.expectedExitCode !== undefined;

  if (!hasStdout && !hasExit) {
    return { passed: false, reason: "test asserts neither stdout nor an exit code" };
  }
  if (hasExit && actual.exitCode !== expected.expectedExitCode) {
    return {
      passed: false,
      reason: `exit code was ${actual.exitCode}, expected ${expected.expectedExitCode}`,
    };
  }
  if (hasStdout) {
    const exp = expected.expectedStdout as string;
    const matches = jsonEqual(actual.stdout, exp) || actual.stdout.trim() === exp.trim();
    if (!matches) return { passed: false, reason: "stdout did not match the expected output" };
  }
  return { passed: true, reason: "ok" };
}

async function runOnce(
  cwd: string,
  command: string,
  timeoutMs: number,
): Promise<Result<ActualOutput & { stderr: string }, ProcessError>> {
  return Result.tryPromise({
    try: async () => {
      const proc = Bun.spawn(["bash", "-lc", command], { cwd, stdout: "pipe", stderr: "pipe" });
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        proc.kill();
      }, timeoutMs);
      try {
        const [stdout, stderr, exitCode] = await Promise.all([
          new Response(proc.stdout).text(),
          new Response(proc.stderr).text(),
          proc.exited,
        ]);
        return {
          stdout,
          stderr: timedOut ? `${stderr}\n(timed out after ${timeoutMs}ms)` : stderr,
          exitCode: exitCode ?? -1,
        };
      } finally {
        clearTimeout(timer);
      }
    },
    catch: (cause) => new ProcessError({ command, cause }),
  });
}

export interface RunSelfTestsOptions {
  tests: SelfTest[];
  /** The program under test: workspace path -> file content. */
  programFiles: Map<string, string>;
  /** Program invocation without arguments, e.g. "python3 solution.py". */
  baseCommand: string;
  timeoutMs?: number;
}

/**
 * Run every self-test against the program in an isolated temp directory and
 * return an aggregate score in the shape the loop already understands.
 */
export async function runSelfTests(opts: RunSelfTestsOptions): Promise<TestResult> {
  const { tests, programFiles, baseCommand } = opts;
  const timeoutMs = opts.timeoutMs ?? 30_000;
  const failing: string[] = [];
  const report: string[] = [];
  let score = 0;

  for (const tc of tests) {
    const dir = await mkdtemp(join(tmpdir(), "agent-selftest-"));
    try {
      for (const [path, content] of programFiles) await Bun.write(join(dir, path), content);
      if (tc.inputName) await Bun.write(join(dir, tc.inputName), tc.inputContent);

      const command = tc.args.trim() ? `${baseCommand} ${tc.args}` : baseCommand;
      const ran = await runOnce(dir, command, timeoutMs);
      if (ran.isErr()) {
        failing.push(tc.name);
        report.push(
          `FAIL ${tc.name} — could not run the program: ${ran.error.message}\n` +
            `  rule: ${tc.rule}\n` +
            `  command: ${command}`,
        );
        continue;
      }
      const actual = ran.value;
      const verdict = checkSelfTest(tc, actual);

      if (verdict.passed) {
        score++;
        report.push(`PASS ${tc.name}`);
      } else {
        failing.push(tc.name);
        report.push(
          `FAIL ${tc.name} — ${verdict.reason}\n` +
            `  rule: ${tc.rule}\n` +
            `  command: ${command}\n` +
            `  expected stdout: ${JSON.stringify(tc.expectedStdout ?? "(any)")}\n` +
            `  actual stdout:   ${JSON.stringify(actual.stdout.slice(0, 600))}\n` +
            `  exit code: ${actual.exitCode} (expected ${tc.expectedExitCode ?? "(any)"})` +
            (actual.stderr.trim() ? `\n  stderr: ${actual.stderr.slice(0, 600)}` : ""),
        );
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  const raw = `SELF-TESTS (spec-derived): ${score}/${tests.length} passing\n\n${report.join("\n")}`;
  return { score, total: tests.length, failing_categories: failing, raw };
}
