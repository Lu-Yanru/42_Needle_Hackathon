import { describe, expect, test } from "bun:test";
import {
  checkSelfTest,
  deriveSpecSelfTests,
  jsonEqual,
  programBaseCommand,
  runSelfTests,
} from "./self-tests";
import type { Plan, SelfTest } from "./state";

describe("programBaseCommand", () => {
  test("strips a trailing <placeholder> token", () => {
    expect(programBaseCommand("python3 solution.py <input_file>")).toBe("python3 solution.py");
  });

  test("leaves a command with no placeholder unchanged", () => {
    expect(programBaseCommand("python3 solution.py")).toBe("python3 solution.py");
  });

  test("strips multiple trailing placeholders and surrounding whitespace", () => {
    expect(programBaseCommand("  node app.js <a> <b>  ")).toBe("node app.js");
  });
});

describe("jsonEqual", () => {
  test("true when objects differ only by key order", () => {
    expect(jsonEqual('{"a":1,"b":2}', '{"b":2,"a":1}')).toBe(true);
  });

  test("true when JSON differs only by whitespace", () => {
    expect(jsonEqual('{"lines":["a","b"],"count":2}', '{ "lines": ["a", "b"], "count": 2 }')).toBe(
      true,
    );
  });

  test("false when array order differs", () => {
    expect(jsonEqual('{"x":["a","b"]}', '{"x":["b","a"]}')).toBe(false);
  });

  test("false when neither side is JSON", () => {
    expect(jsonEqual("hello", "hello")).toBe(false);
  });
});

describe("checkSelfTest", () => {
  test("passes when the exit code matches", () => {
    expect(checkSelfTest({ expectedExitCode: 0 }, { stdout: "x", stderr: "", exitCode: 0 }).passed).toBe(true);
  });

  test("fails when the exit code differs", () => {
    expect(checkSelfTest({ expectedExitCode: 1 }, { stdout: "", stderr: "", exitCode: 0 }).passed).toBe(false);
  });

  test("passes on stdout match, ignoring trailing whitespace", () => {
    expect(checkSelfTest({ expectedStdout: "hello" }, { stdout: "hello\n", stderr: "", exitCode: 0 }).passed).toBe(
      true,
    );
  });

  test("fails when stdout differs", () => {
    expect(checkSelfTest({ expectedStdout: "hello" }, { stdout: "bye", stderr: "", exitCode: 0 }).passed).toBe(
      false,
    );
  });

  test("passes when JSON stdout matches despite key order", () => {
    expect(
      checkSelfTest({ expectedStdout: '{"a":1,"b":2}' }, { stdout: '{"b":2,"a":1}', stderr: "", exitCode: 0 })
        .passed,
    ).toBe(true);
  });

  test("fails when one of two checks fails", () => {
    expect(
      checkSelfTest({ expectedStdout: "hi", expectedExitCode: 0 }, { stdout: "hi", stderr: "", exitCode: 1 })
        .passed,
    ).toBe(false);
  });

  test("fails when the test asserts nothing", () => {
    expect(checkSelfTest({}, { stdout: "x", stderr: "", exitCode: 0 }).passed).toBe(false);
  });

  test("passes when stderr matches, ignoring trailing whitespace", () => {
    expect(
      checkSelfTest({ expectedStderr: "error: nope" }, { stdout: "", stderr: "error: nope\n", exitCode: 1 })
        .passed,
    ).toBe(true);
  });

  test("fails when stderr differs", () => {
    expect(
      checkSelfTest({ expectedStderr: "error: nope" }, { stdout: "", stderr: "error: yep", exitCode: 1 })
        .passed,
    ).toBe(false);
  });
});

describe("deriveSpecSelfTests", () => {
  test("extracts exact stdout and stderr examples from the specification", () => {
    const plan: Plan = {
      steps: ["implement the cli"],
      entrypoint: "solution.py",
      run_command: "python3 solution.py",
      required_inputs: "cli args",
      required_outputs: "stdout/stderr",
      edge_cases: ["bad args"],
    };
    const spec = `
\`\`\`bash
$ python3 solution.py --seed 42
05giropRLVVVDfuI
\`\`\`

\`\`\`
$ python3 solution.py --length 0
error: --length must be a positive integer
\`\`\`

The line above is written to stderr; exit code is \`1\`.
`;

    const tests = deriveSpecSelfTests(spec, plan);

    expect(tests).toHaveLength(2);
    expect(tests[0]).toMatchObject({
      args: "--seed 42",
      expectedStdout: "05giropRLVVVDfuI",
      expectedExitCode: 0,
    });
    expect(tests[1]).toMatchObject({
      args: "--length 0",
      expectedStderr: "error: --length must be a positive integer",
      expectedExitCode: 1,
    });
  });
});

describe("runSelfTests", () => {
  test("runs the program per case and scores pass/fail", async () => {
    const programFiles = new Map<string, string>([["cat.sh", 'cat "$1"\n']]);
    const tests: SelfTest[] = [
      {
        name: "echoes input",
        rule: "program prints the file contents",
        inputName: "in.txt",
        inputContent: "hi",
        args: "in.txt",
        expectedStdout: "hi",
        expectedExitCode: 0,
      },
      {
        name: "wrong expectation",
        rule: "intentionally failing case",
        inputName: "in.txt",
        inputContent: "hi",
        args: "in.txt",
        expectedStdout: "WRONG",
        expectedExitCode: 0,
      },
    ];

    const result = await runSelfTests({ tests, programFiles, baseCommand: "bash cat.sh" });

    expect(result.score).toBe(1);
    expect(result.total).toBe(2);
    expect(result.failing_categories).toContain("wrong expectation");
  });
});
