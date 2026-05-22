// Run state and the plan schema shared between the model and the loop.

import { z } from "zod";

export type Phase =
  | "PLANNING"
  | "GENERATE_TESTS"
  | "IMPLEMENTING"
  | "TESTING"
  | "FIXING"
  | "DONE"
  | "FAILED";

export const PlanSchema = z.object({
  steps: z.array(z.string()).describe("Ordered implementation steps"),
  entrypoint: z.string().describe("Main program file, e.g. solution.py"),
  run_command: z.string().describe("Command that runs the finished program"),
  required_inputs: z.string().describe("Input format the program must accept"),
  required_outputs: z.string().describe("Output format the program must produce"),
  edge_cases: z.array(z.string()).describe("Edge cases to handle"),
});
export type Plan = z.infer<typeof PlanSchema>;

const ActionBaseSchema = z.object({
  reasoning: z.string().describe("One sentence: why you are taking this action"),
});

/**
 * One action the model takes per turn in IMPLEMENTING / FIXING.
 * Generated as schema-constrained structured output, so the response is
 * guaranteed to be a valid action object.
 */
export const ActionSchema = z.discriminatedUnion("tool", [
  ActionBaseSchema.extend({
    tool: z.literal("read_file").describe("Read an existing file"),
    path: z.string().describe("File path to inspect"),
  }),
  ActionBaseSchema.extend({
    tool: z.literal("write_file").describe("Create or fully rewrite a file"),
    path: z.string().describe("File path to write"),
    content: z.string().describe("Full file content"),
  }),
  ActionBaseSchema.extend({
    tool: z.literal("edit_file").describe("Patch an existing file"),
    path: z.string().describe("File path to patch"),
    search: z.string().min(1).describe("Exact text to replace"),
    replace: z.string().describe("Replacement text"),
    replace_all: z.boolean().optional().describe("Replace every occurrence instead of only the first"),
  }),
  ActionBaseSchema.extend({
    tool: z.literal("list_dir").describe("List files in the workspace"),
  }),
  ActionBaseSchema.extend({
    tool: z.literal("run_command").describe("Run a shell command"),
    command: z.string().describe("Concrete shell command"),
  }),
  ActionBaseSchema.extend({
    tool: z.literal("finish_phase").describe("Tell the harness this phase is ready for testing"),
    summary: z.string().describe("What you accomplished"),
  }),
]);
export type Action = z.infer<typeof ActionSchema>;

/**
 * One spec-derived test case. The harness writes the input file in an isolated
 * directory, runs the program with `args`, and checks the captured output.
 * Expected values come from the SPECIFICATION, never from running the program.
 *
 * The schema is intentionally flat (no nested arrays of objects) so each test
 * is generated and deduplicated as a single self-contained object.
 */
export const SelfTestSchema = z.object({
  name: z.string().describe("Short label for this case"),
  rule: z.string().describe("The specification requirement this case verifies"),
  inputName: z
    .string()
    .describe('Filename for the input file; "" if the test needs no input file'),
  inputContent: z.string().describe("Exact content of the input file"),
  args: z.string().describe("Command-line arguments passed to the program"),
  expectedStdout: z.string().optional().describe("Exact stdout the program must print"),
  expectedStderr: z.string().optional().describe("Exact stderr the program must print"),
  expectedExitCode: z.number().int().optional().describe("Exit code the program must return"),
});
export type SelfTest = z.infer<typeof SelfTestSchema>;

/** A batch of spec-derived test cases — the GENERATE_TESTS phase output. */
export const SelfTestSuiteSchema = z.object({
  tests: z.array(SelfTestSchema).describe("The spec-derived test cases"),
});
export type SelfTestSuite = z.infer<typeof SelfTestSuiteSchema>;

export interface TestResult {
  score: number;
  total: number;
  failing_categories: string[];
  raw: string;
  error?: string;
}

export interface ScorePoint {
  ts: string;
  score: number;
  total: number;
}

export interface RepeatedRunState {
  command: string;
  fingerprint: string;
  repeats: number;
}

export interface RunState {
  specPath: string;
  spec: string;
  workspaceDir: string;
  phase: Phase;
  plan: Plan | null;
  iteration: number;
  maxIterations: number;
  bestScore: number;
  noImprovementStreak: number;
  planFailures: number;
  lastTestResult: TestResult | null;
  /** Workspace contents at the best score so far — the rollback target. */
  lastGoodSnapshot: Map<string, string> | null;
  scoreProgression: ScorePoint[];
  /** Spec-derived test cases, generated once in the GENERATE_TESTS phase. */
  selfTests: SelfTest[];
  /** Official test command (from --test-cmd / AGENT_TEST_CMD); "" = auto-detect. */
  testCommand: string;
  /** Which test source produced the last result. */
  testSource: "official" | "self" | "none";
  /** Harness-owned verification anchor commands for cheap, deterministic checks. */
  verificationCommands: string[];
  /** Round-robin cursor into verificationCommands. */
  nextVerificationIndex: number;
  /** Repeated command/failure memory across phase boundaries. */
  lastRunState: RepeatedRunState | null;
  dryRun: boolean;
}
