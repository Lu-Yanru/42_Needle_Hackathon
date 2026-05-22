// Shared types for the Operator Console agent data model.
// The server owns the source of truth — it reads the agent's real run
// artifacts under .needle-agent/ — and the web app consumes these via oRPC.

export type Phase =
  | "PLANNING"
  | "GENERATE_TESTS"
  | "IMPLEMENTING"
  | "TESTING"
  | "FIXING"
  | "DONE"
  | "FAILED";

export type TimelineType = "plan" | "decide" | "cmd" | "test" | "edit" | "fail" | "error" | "human";

export type FileStatus = "created" | "edited" | "rolled-back";

export interface RunState {
  phase: Phase | null;
  iteration: number;
  maxIterations: number;
  /** ISO timestamp, or null when no run has started. */
  startedAt: string | null;
  /** ISO timestamp, set once a run reaches DONE / FAILED. */
  completedAt: string | null;
  model: string;
  running: boolean;
  paused: boolean;
  stuck: boolean;
}

/** Cumulative run counters, straight from the agent's state.json. */
export interface RunStats {
  modelCalls: number;
  toolCalls: number;
  inputTokens: number;
  outputTokens: number;
  errors: number;
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
  /** Current file contents — read live from the agent workspace. */
  content: string;
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
  run: RunState;
  stats: RunStats;
  scores: ScorePoint[];
  timeline: TimelineEvent[];
  logs: Logs;
  files: WorkspaceFile[];
  manifest: Manifest;
  checklist: ChecklistItem[];
  report: string | null;
  /** ISO timestamp of the submission deadline. */
  deadline: string;
  /** ISO timestamp the snapshot was last produced by the server. */
  updatedAt: string;
}

export type ControlAction = "start" | "pause" | "resume" | "stop" | "continue";

/** Summary of one archived run, for the console's session switcher. */
export interface SessionSummary {
  id: string;
  phase: Phase | null;
  iteration: number;
  score: number | null;
  total: number | null;
  startedAt: string | null;
  completedAt: string | null;
}

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
