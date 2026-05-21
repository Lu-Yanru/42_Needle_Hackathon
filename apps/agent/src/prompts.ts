// System and per-phase prompt templates.

import type { Plan, SelfTest } from "./state";
import type { AnyTool } from "./tools/types";

export function systemPrompt(tools: AnyTool[]): string {
  const toolList = tools.map((t) => `- ${t.name}: ${t.description}`).join("\n");
  return `You are an autonomous coding agent. You implement a program from a written specification, run it, and fix it until the tests pass.

Each turn you respond with exactly ONE action as a JSON object. The fields each action needs:

- read_file    — { "tool": "read_file", "path": "<file>" }
- write_file   — { "tool": "write_file", "path": "<file>", "content": "<full file content>" }
- edit_file    — { "tool": "edit_file", "path": "<file>", "search": "<exact old text>", "replace": "<new text>", "replace_all": false }
- list_dir     — { "tool": "list_dir" }
- run_command  — { "tool": "run_command", "command": "<shell command>" }
- finish_phase — { "tool": "finish_phase", "summary": "<what you did>" }

Every action object also needs a "reasoning" field (one sentence).

What the tools do:
${toolList}

Rules:
- The specification is the source of truth. Implement exactly what it asks — no extra features.
- Make small, targeted changes. Never rewrite a whole file to fix one bug.
- Prefer edit_file for small fixes; use write_file only for first creation or when a large rewrite is truly necessary.
- Never print debug output to stdout in the final program; it breaks the test harness.
- Never treat spec placeholders like L, N, S, or <input_file> as literal runtime values.
- If you use run_command, it must contain only concrete executable arguments that a shell can run right now.
- The harness automatically runs one deterministic verification command after every successful write_file or edit_file. Do not spend turns inventing routine verification commands when those harness checks are enough.
- Inspect before you edit: use read_file or list_dir to understand the current state.
- When the code for the current phase is ready, use the finish_phase action.
- Respond with ONLY the JSON action object — no prose, no markdown.`;
}

export function planningPrompt(spec: string): string {
  return `Read this specification and produce an implementation plan. Do NOT write any code yet.

SPECIFICATION:
---
${spec}
---

Respond with a JSON object describing: the ordered implementation steps, the entrypoint file, the command to run the finished program, the input format, the output format, and the edge cases to handle.`;
}

export function implementingPrompt(plan: Plan, files: string, verificationCommands: string[]): string {
  return `Implement the plan below. Create the program files with the write_file tool.

PLAN:
${JSON.stringify(plan, null, 2)}

EXECUTABLE BASE COMMAND:
${plan.run_command}

HARNESS VERIFICATION COMMANDS:
${verificationCommands.map((command) => `- ${command}`).join("\n")}

CURRENT WORKSPACE FILES:
${files}

Write the files needed to satisfy the plan. Start with the minimal working program, then handle the valid cases and edge cases.
Only inspect or edit files that are relevant to this entrypoint. Prefer one edit, let the harness run its automatic verification, then continue or finish_phase.`;
}

export function fixingPrompt(plan: Plan, failureSignal: string, files: string, verificationCommands: string[]): string {
  return `The test suite was run. Fix the failing tests.

PLAN:
${JSON.stringify(plan, null, 2)}

EXECUTABLE BASE COMMAND:
${plan.run_command}

HARNESS VERIFICATION COMMANDS:
${verificationCommands.map((command) => `- ${command}`).join("\n")}

${failureSignal}

CURRENT WORKSPACE FILES:
${files}

Fix ONE failing category at a time with a small, targeted edit. Use read_file to inspect a file, then write_file to update it — do not rewrite everything.
Prefer edit_file for targeted fixes. The harness auto-runs one verification command after each successful edit, so only use run_command when those checks are insufficient.
If a command keeps failing with the same message, stop rerunning it and change the code instead. When your fix is ready to re-test, call finish_phase.`;
}

export function stuckPrompt(plan: Plan, failureSignal: string, files: string, verificationCommands: string[]): string {
  return `You have made several attempts with no score improvement. Stop repeating the same fix.

PLAN:
${JSON.stringify(plan, null, 2)}

EXECUTABLE BASE COMMAND:
${plan.run_command}

HARNESS VERIFICATION COMMANDS:
${verificationCommands.map((command) => `- ${command}`).join("\n")}

${failureSignal}

CURRENT WORKSPACE FILES:
${files}

First, in one short paragraph, analyse WHY this keeps failing. Then take a genuinely DIFFERENT approach than your previous attempts. Use read_file then write_file, and call finish_phase when ready to re-test.`;
}

export function generateTestPrompt(spec: string, plan: Plan, existing: SelfTest[]): string {
  const covered =
    existing.length > 0
      ? `\nAlready covered — pick a DIFFERENT case than these:\n${existing
          .map((t) => `- ${t.name}: ${t.rule}`)
          .join("\n")}\n`
      : "";
  return `Read this specification and write ONE test case for a program implementing it.

SPECIFICATION:
---
${spec}
---

The finished program is run as: ${plan.run_command}
${covered}
Respond with ONE test case as a JSON object:
- name: a short label;
- rule: the single specification requirement this case checks;
- inputName + inputContent: the input file to create (set inputName to "" if the test needs no input file, e.g. a missing-file test);
- args: the command-line arguments to pass to the program;
- expectedStdout and/or expectedStderr and/or expectedExitCode: the EXACT expected result.

Work out the expected result by reasoning about the SPECIFICATION yourself —
never by running a program. Across calls, cover the normal case, the edge
cases, and the error cases.`;
}
