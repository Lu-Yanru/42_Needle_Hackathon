import { describe, expect, test } from "bun:test";
import type { Plan, TestResult } from "./state";
import {
  compactFailureSignal,
  deriveVerificationCommands,
  isUniqueSelfTest,
  normalizePlan,
  renderWorkspacePreview,
  shouldStopRepeatedRunCommand,
} from "./harness-helpers";
import type { SelfTest } from "./state";

const plan: Plan = {
  steps: ["Parse args", "Generate output"],
  entrypoint: "solution.py",
  run_command:
    "python3 solution.py --length L --count N --seed S --symbols --no-lower --no-upper --no-digits",
  required_inputs: "cli flags",
  required_outputs: "stdout lines",
  edge_cases: [],
};

describe("normalizePlan", () => {
  test("strips placeholder flags from model-generated run commands", () => {
    expect(normalizePlan(plan).run_command).toBe("python3 solution.py");
  });

  test("keeps a simple executable command unchanged", () => {
    expect(
      normalizePlan({
        ...plan,
        run_command: "python3 solution.py",
      }).run_command,
    ).toBe("python3 solution.py");
  });
});

describe("renderWorkspacePreview", () => {
  test("prioritizes the entrypoint and excludes irrelevant stale files", () => {
    const preview = renderWorkspacePreview(
      ["run_command.json", "sample.txt", "solution.py", "notes.txt"],
      new Map([
        ["run_command.json", '{"tool":"run_command"}'],
        ["sample.txt", "Line1\nLine2"],
        ["solution.py", "print('ok')\n"],
        ["notes.txt", "scratch"],
      ]),
      "solution.py",
    );

    expect(preview).toContain("### solution.py");
    expect(preview).toContain("OTHER FILES: 3 additional file(s) hidden");
    expect(preview).not.toContain("### run_command.json");
    expect(preview).not.toContain("### sample.txt");
    expect(preview).not.toContain("run_command.json");
    expect(preview).not.toContain("sample.txt");
  });
});

describe("compactFailureSignal", () => {
  test("deduplicates repeated categories and keeps the actionable tail", () => {
    const result: TestResult = {
      score: 0,
      total: 6,
      failing_categories: [
        "Test with default values",
        "Test with custom length",
        "Test with custom length",
      ],
      raw: "line 1\nline 2\nstderr:\nsolution.py: error: argument --length: invalid int value: 'L'\n",
    };

    const summary = compactFailureSignal(result);

    expect(summary).toContain("TEST RESULT: 0/6 passing");
    expect(summary).toContain("FAILING CATEGORIES: Test with default values, Test with custom length");
    expect(summary).not.toContain("Test with custom length, Test with custom length");
    expect(summary).toContain("invalid int value: 'L'");
  });
});

describe("shouldStopRepeatedRunCommand", () => {
  test("stops after the same failing command repeats with the same fingerprint", () => {
    expect(
      shouldStopRepeatedRunCommand(
        {
          command: "python3 solution.py --length 10",
          fingerprint: "exit code: 1\nstderr: boom",
          repeats: 1,
        },
        "python3 solution.py --length 10",
        "exit code: 1\nstderr: boom",
      ),
    ).toEqual({
      repeated: true,
      shouldStop: true,
      nextState: {
        command: "python3 solution.py --length 10",
        fingerprint: "exit code: 1\nstderr: boom",
        repeats: 2,
      },
    });
  });
});

describe("deriveVerificationCommands", () => {
  test("prefers deterministic no-input self-tests as harness-owned verification anchors", () => {
    const commands = deriveVerificationCommands("python3 solution.py", [
      {
        name: "spec example 1",
        rule: "seeded happy path",
        inputName: "",
        inputContent: "",
        args: "--seed 42",
        expectedStdout: "abc",
        expectedExitCode: 0,
      },
      {
        name: "spec example 2",
        rule: "error path",
        inputName: "",
        inputContent: "",
        args: "--length 0",
        expectedStderr: "error: --length must be a positive integer",
        expectedExitCode: 1,
      },
      {
        name: "needs fixture file",
        rule: "file input path",
        inputName: "input.txt",
        inputContent: "hello",
        args: "input.txt",
        expectedStdout: "hello",
        expectedExitCode: 0,
      },
    ]);

    expect(commands).toEqual(["python3 solution.py --seed 42", "python3 solution.py --length 0"]);
  });

  test("falls back to the base command when no deterministic no-input tests exist", () => {
    expect(
      deriveVerificationCommands("python3 solution.py", [
        {
          name: "requires file",
          rule: "file input path",
          inputName: "input.txt",
          inputContent: "hello",
          args: "input.txt",
          expectedStdout: "hello",
          expectedExitCode: 0,
        },
      ]),
    ).toEqual(["python3 solution.py"]);
  });
});

describe("isUniqueSelfTest", () => {
  test("rejects a duplicate test case with the same expectations", () => {
    const existing: SelfTest[] = [
      {
        name: "Generate one password with custom length",
        rule: "custom length",
        inputName: "",
        inputContent: "",
        args: "--length 20 --count 3 --seed 7 --symbols",
        expectedStdout: "abc",
      },
    ];

    expect(
      isUniqueSelfTest(existing, {
        name: "Generate one password with custom length and seed",
        rule: "custom length",
        inputName: "",
        inputContent: "",
        args: "--length 20 --count 3 --seed 7 --symbols",
        expectedStdout: "abc",
      }),
    ).toBeFalse();
  });

  test("keeps cases with different expectations", () => {
    const existing: SelfTest[] = [
      {
        name: "default example",
        rule: "example output",
        inputName: "",
        inputContent: "",
        args: "--seed 42",
        expectedStdout: "abc",
      },
    ];

    expect(
      isUniqueSelfTest(existing, {
        name: "different example",
        rule: "example output",
        inputName: "",
        inputContent: "",
        args: "--seed 42",
        expectedStdout: "def",
      }),
    ).toBeTrue();
  });
});
