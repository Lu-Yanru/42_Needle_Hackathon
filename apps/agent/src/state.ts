// Run state and the plan schema shared between the model and the loop.

import { z } from "zod";

export type Phase = "PLANNING" | "IMPLEMENTING" | "TESTING" | "FIXING" | "DONE" | "FAILED";

export const PlanSchema = z.object({
  steps: z.array(z.string()).describe("Ordered implementation steps"),
  entrypoint: z.string().describe("Main program file, e.g. solution.py"),
  run_command: z.string().describe("Command that runs the finished program"),
  required_inputs: z.string().describe("Input format the program must accept"),
  required_outputs: z.string().describe("Output format the program must produce"),
  edge_cases: z.array(z.string()).describe("Edge cases to handle"),
});
export type Plan = z.infer<typeof PlanSchema>;

/**
 * One action the model takes per turn in IMPLEMENTING / FIXING.
 * Sent to Ollama as a `format` JSON schema so the response is guaranteed
 * to be a valid action object — local models do not reliably emit native
 * tool calls.
 */
export const ActionSchema = z.object({
  reasoning: z.string().describe("One sentence: why you are taking this action"),
  tool: z
    .enum(["read_file", "write_file", "list_dir", "run_command", "finish_phase"])
    .describe("The action to take"),
  path: z.string().optional().describe("File path — for read_file and write_file"),
  content: z.string().optional().describe("Full file content — for write_file"),
  command: z.string().optional().describe("Shell command — for run_command"),
  summary: z.string().optional().describe("What you accomplished — for finish_phase"),
});
export type Action = z.infer<typeof ActionSchema>;

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
  dryRun: boolean;
}
