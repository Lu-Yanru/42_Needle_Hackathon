// Shapes of the files the agent writes to agent_logs/.
// Mirrors apps/agent/src/events.ts — the agent is the source of truth.
// Kept as a local copy so the TUI has zero dependency on the agent package.

export type Phase = "PLANNING" | "IMPLEMENTING" | "TESTING" | "FIXING" | "DONE" | "FAILED";

export interface RunEvent {
  seq: number;
  ts: string;
  type: string;
  [key: string]: unknown;
}

export interface ScorePoint {
  ts: string;
  score: number;
  total: number;
}

export interface RunStateSnapshot {
  updatedAt: string;
  phase: Phase;
  iteration: number;
  maxIterations: number;
  bestScore: number;
  noImprovementStreak: number;
  lastScore: number | null;
  lastTotal: number | null;
  scoreProgression: ScorePoint[];
  totalInputTokens: number;
  totalOutputTokens: number;
  modelCalls: number;
  toolCalls: number;
  errors: number;
  done: boolean;
}
