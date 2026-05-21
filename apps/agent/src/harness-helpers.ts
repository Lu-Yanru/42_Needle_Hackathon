import type { Plan, RepeatedRunState, SelfTest, TestResult } from "./state";
import { truncateTail } from "./truncate";

function tokenize(command: string): string[] {
  return command.trim().split(/\s+/).filter(Boolean);
}

function inferBaseCommand(entrypoint: string): string {
  if (entrypoint.endsWith(".py")) return `python3 ${entrypoint}`;
  if (entrypoint.endsWith(".sh")) return `bash ${entrypoint}`;
  if (entrypoint.endsWith(".ts")) return `bun run ${entrypoint}`;
  if (entrypoint.endsWith(".js") || entrypoint.endsWith(".mjs")) return `node ${entrypoint}`;
  return entrypoint;
}

export function sanitizeRunCommand(entrypoint: string, runCommand: string): string {
  const tokens = tokenize(runCommand);
  const entryIndex = tokens.findIndex((token) => token === entrypoint);
  if (entryIndex >= 0) {
    const base = tokens.slice(0, entryIndex + 1).join(" ").trim();
    if (base) return base;
  }
  return inferBaseCommand(entrypoint);
}

export function normalizePlan(plan: Plan): Plan {
  return {
    ...plan,
    run_command: sanitizeRunCommand(plan.entrypoint, plan.run_command),
  };
}

export function renderWorkspacePreview(
  files: string[],
  fileContents: Map<string, string>,
  entrypoint: string | null,
): string {
  if (files.length === 0) return "(workspace is empty)";

  const lines: string[] = [];
  if (entrypoint && files.includes(entrypoint)) {
    const content = fileContents.get(entrypoint) ?? "";
    lines.push(`### ${entrypoint}\n\`\`\`\n${content}\n\`\`\``);
  }

  const others = files.filter((file) => file !== entrypoint);
  if (others.length > 0) {
    lines.push(
      `OTHER FILES: ${others.length} additional file(s) hidden to keep context focused. Use list_dir if you need to inspect them.`,
    );
  }

  return lines.join("\n\n");
}

export function compactFailureSignal(result: TestResult): string {
  const categories = [...new Set(result.failing_categories)].slice(0, 6);
  const tail = truncateTail(result.raw || "(no output)", { maxLines: 24, maxBytes: 1200 }).content;
  return [
    `TEST RESULT: ${result.score}/${result.total} passing`,
    `FAILING CATEGORIES: ${categories.join(", ") || "(not categorised)"}`,
    "",
    "TEST OUTPUT + PROGRAM DIAGNOSTICS:",
    tail,
  ].join("\n");
}

export function deriveVerificationCommands(baseCommand: string, tests: SelfTest[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const test of tests) {
    if (test.inputName.trim() !== "") continue;
    const command = test.args.trim() ? `${baseCommand} ${test.args.trim()}` : baseCommand;
    if (seen.has(command)) continue;
    seen.add(command);
    out.push(command);
  }
  return out.length > 0 ? out : [baseCommand];
}

function fingerprintOutput(output: string): string {
  return truncateTail(output, { maxLines: 8, maxBytes: 500 }).content.trim();
}

export function shouldStopRepeatedRunCommand(
  previous: RepeatedRunState | null,
  command: string,
  output: string,
): { repeated: boolean; shouldStop: boolean; nextState: RepeatedRunState } {
  const fingerprint = fingerprintOutput(output);
  const repeated =
    previous !== null &&
    previous.command === command &&
    previous.fingerprint === fingerprint;
  const repeats = repeated ? previous.repeats + 1 : 1;
  return {
    repeated,
    shouldStop: repeats >= 2,
    nextState: { command, fingerprint, repeats },
  };
}

export function isUniqueSelfTest(existing: SelfTest[], candidate: SelfTest): boolean {
  return !existing.some(
    (test) =>
      test.rule.trim() === candidate.rule.trim() &&
      test.args.trim() === candidate.args.trim() &&
      test.inputName.trim() === candidate.inputName.trim() &&
      test.inputContent.trim() === candidate.inputContent.trim() &&
      (test.expectedStdout ?? "").trim() === (candidate.expectedStdout ?? "").trim() &&
      (test.expectedStderr ?? "").trim() === (candidate.expectedStderr ?? "").trim() &&
      (test.expectedExitCode ?? null) === (candidate.expectedExitCode ?? null),
  );
}
