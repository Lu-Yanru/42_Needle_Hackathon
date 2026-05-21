// System and per-phase prompt templates.

import type { Plan, TestResult } from "./state";
import type { AnyTool } from "./tools/types";

export function systemPrompt(tools: AnyTool[]): string {
  const toolList = tools.map((t) => `- ${t.name}: ${t.description}`).join("\n");
  return `You are an autonomous coding agent. You implement a program from a written specification, run it, and fix it until the tests pass.

You make progress by calling tools. Available tools:
${toolList}

Rules:
- The specification is the source of truth. Implement exactly what it asks — no extra features.
- Make small, targeted changes. Never rewrite a whole file to fix one bug.
- Never print debug output to stdout in the final program; it breaks the test harness.
- Inspect before you edit: use read_file / list_dir to understand the current state.
- When the code for the current phase is ready, call ${"finish_phase"}.
- Work autonomously. Do not ask the user questions.`;
}

export function planningPrompt(spec: string): string {
  return `Read this specification and produce an implementation plan. Do NOT write any code yet.

SPECIFICATION:
---
${spec}
---

Respond with a JSON object describing: the ordered implementation steps, the entrypoint file, the command to run the finished program, the input format, the output format, and the edge cases to handle.`;
}

export function implementingPrompt(plan: Plan, files: string): string {
  return `Implement the plan below. Create the program files with the write_file tool.

PLAN:
${JSON.stringify(plan, null, 2)}

CURRENT WORKSPACE FILES:
${files}

Write the files needed to satisfy the plan. Start with the minimal working program, then handle the valid cases and edge cases. When the implementation is complete and ready to test, call finish_phase.`;
}

export function fixingPrompt(plan: Plan, result: TestResult, files: string): string {
  return `The test suite was run. Fix the failing tests.

PLAN:
${JSON.stringify(plan, null, 2)}

TEST RESULT: ${result.score}/${result.total} passing
FAILING CATEGORIES: ${result.failing_categories.join(", ") || "(not categorised)"}

TEST OUTPUT (tail):
${result.raw.slice(-2500) || "(no output)"}

CURRENT WORKSPACE FILES:
${files}

Fix ONE failing category at a time with a small, targeted edit. Use read_file to inspect a file, then write_file to update it — do not rewrite everything. When your fix is ready to re-test, call finish_phase.`;
}

export function stuckPrompt(plan: Plan, result: TestResult, files: string): string {
  return `You have made several attempts with no score improvement. Stop repeating the same fix.

PLAN:
${JSON.stringify(plan, null, 2)}

TEST RESULT: ${result.score}/${result.total} passing
FAILING CATEGORIES: ${result.failing_categories.join(", ") || "(not categorised)"}

TEST OUTPUT (tail):
${result.raw.slice(-2500) || "(no output)"}

CURRENT WORKSPACE FILES:
${files}

First, in one short paragraph, analyse WHY this keeps failing. Then take a genuinely DIFFERENT approach than your previous attempts. Use read_file then write_file, and call finish_phase when ready to re-test.`;
}
