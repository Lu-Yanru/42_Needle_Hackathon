import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadCheckpoint, writeCheckpoint } from "./checkpoint";
import type { RunState } from "./state";

function sampleState(): RunState {
  return {
    specPath: "SPEC.md",
    spec: "Build a thing that does a thing.",
    workspaceDir: "/tmp/needle-ws",
    phase: "FIXING",
    plan: {
      steps: ["read input", "compute", "print"],
      entrypoint: "solution.py",
      run_command: "python3 solution.py",
      required_inputs: "one line on stdin",
      required_outputs: "one number on stdout",
      edge_cases: ["empty input"],
    },
    iteration: 7,
    maxIterations: 40,
    bestScore: 3,
    noImprovementStreak: 1,
    planFailures: 0,
    lastTestResult: { score: 3, total: 5, failing_categories: ["edge"], raw: "3/5 passed" },
    lastGoodSnapshot: new Map([
      ["solution.py", "print(1)\n"],
      ["helper.py", "X = 2\n"],
    ]),
    scoreProgression: [{ ts: "2026-05-22T09:00:00.000Z", score: 3, total: 5 }],
    selfTests: [
      { name: "t1", rule: "prints the number", inputName: "", inputContent: "", args: "", expectedStdout: "1" },
    ],
    testCommand: "",
    testSource: "self",
    verificationCommands: ["python3 solution.py"],
    nextVerificationIndex: 1,
    lastRunState: null,
    dryRun: false,
  };
}

describe("checkpoint round-trip", () => {
  test("writeCheckpoint then loadCheckpoint restores RunState, including the Map", async () => {
    const dir = mkdtempSync(join(tmpdir(), "needle-ckpt-"));
    const original = sampleState();

    await writeCheckpoint(dir, original);
    const restored = await loadCheckpoint(dir);

    expect(restored).not.toBeNull();
    expect(restored).toEqual(original);
    expect(restored?.lastGoodSnapshot).toBeInstanceOf(Map);
    expect(restored?.lastGoodSnapshot?.get("solution.py")).toBe("print(1)\n");
  });

  test("a null lastGoodSnapshot round-trips as null", async () => {
    const dir = mkdtempSync(join(tmpdir(), "needle-ckpt-"));
    const original = { ...sampleState(), lastGoodSnapshot: null };

    await writeCheckpoint(dir, original);
    const restored = await loadCheckpoint(dir);

    expect(restored?.lastGoodSnapshot).toBeNull();
  });

  test("loadCheckpoint returns null when no checkpoint exists", async () => {
    const dir = mkdtempSync(join(tmpdir(), "needle-ckpt-"));
    expect(await loadCheckpoint(dir)).toBeNull();
  });
});
