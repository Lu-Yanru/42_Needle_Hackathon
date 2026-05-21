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
