// Shared types for the Operator Console agent data model.
// The server owns the source of truth; the web app consumes these via oRPC.

export type Phase = "PLANNING" | "IMPLEMENTING" | "TESTING" | "FIXING" | "DONE" | "ERROR";

export type Scenario = "climbing" | "stuck" | "done" | "empty";

export type TimelineType = "plan" | "decide" | "cmd" | "test" | "edit" | "fail" | "error" | "human";

export type FileStatus = "created" | "edited" | "rolled-back";

export interface RunState {
  phase: Phase | null;
  iteration: number;
  maxIterations: number;
  /** ISO timestamp, or null when no run has started. */
  startedAt: string | null;
  /** ISO timestamp, set once a run reaches DONE. */
  completedAt: string | null;
  model: string;
  running: boolean;
  paused: boolean;
  stuck: boolean;
}

export interface FailingCategory {
  name: string;
  count: number;
}

export interface ScorePoint {
  iter: number;
  /** Human-readable "YYYY-MM-DD HH:MM" stamp. */
  timestamp: string;
  score: number;
  total: number;
  suite: string;
  regressed: boolean;
  failingCategories: FailingCategory[];
}

export interface TimelineEvent {
  /** Human-readable "YYYY-MM-DD HH:MM:SS" stamp. */
  ts: string;
  type: TimelineType;
  summary: string;
  meta: string;
  detail: string | null;
}

/** Map of log file name -> ordered lines. */
export type Logs = Record<string, string[]>;

export interface WorkspaceFile {
  path: string;
  status: FileStatus;
  added: number;
  removed: number;
  hasSnapshot: boolean;
  rolledBack: boolean;
}

export interface Manifest {
  primary_model: string;
  provider: string;
  additional_models: string[];
  paid_usage: {
    paid_inference: boolean;
    paid_apis: boolean;
    paid_tools: boolean;
  };
  hardware: string;
  offline: boolean;
}

export interface ChecklistItem {
  label: string;
  ok: boolean;
  warn: boolean;
  meta: string;
}

export interface AgentSnapshot {
  scenario: Scenario;
  run: RunState;
  scores: ScorePoint[];
  timeline: TimelineEvent[];
  logs: Logs;
  files: WorkspaceFile[];
  manifest: Manifest;
  checklist: ChecklistItem[];
  report: string | null;
  /** ISO timestamp of the Friday 12:00 submission deadline. */
  deadline: string;
  /** ISO timestamp the snapshot was last produced by the server. */
  updatedAt: string;
}

export type ControlAction = "start" | "pause" | "resume" | "stop";

export interface InterventionInput {
  type: string;
  what: string;
  why: string;
  files: string;
  touched: boolean;
  notes: string;
}

export interface PromptInput {
  text: string;
  intervention: boolean;
}

export interface PromptResult {
  reply: string;
  model: string;
}
