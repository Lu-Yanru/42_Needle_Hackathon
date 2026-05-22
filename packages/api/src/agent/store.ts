// Operator Console data source — backed entirely by the agent's real run
// artifacts under .needle-agent/ (run.jsonl, state.json, the seven *.log files)
// plus the live agent workspace. There is no mock data: every field returned
// here is read from a file the agent actually wrote.
//
//   run.jsonl  — append-only structured event stream (timeline + scores)
//   state.json — current-status snapshot (phase, iteration, counters)
//   *.log      — the seven required human-readable logs
//
// Operator actions write back to the same real files and, for run controls,
// spawn / signal the actual agent process.

import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
  type Stats,
} from "node:fs";
import { cpus, totalmem } from "node:os";
import { dirname, join } from "node:path";

import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { generateText } from "ai";

import type {
  AgentSnapshot,
  ChecklistItem,
  ControlAction,
  FailingCategory,
  InterventionInput,
  Logs,
  Manifest,
  Phase,
  PromptInput,
  PromptResult,
  RunState,
  RunStats,
  ScorePoint,
  SessionSummary,
  TimelineEvent,
  TimelineType,
  WorkspaceFile,
} from "./types";

// ---------- paths ----------

/** Walk up to the monorepo root (the directory holding turbo.json). */
function findRepoRoot(): string {
  let dir = import.meta.dir;
  for (let i = 0; i < 12; i++) {
    if (existsSync(join(dir, "turbo.json"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return process.cwd();
}

const REPO_ROOT = findRepoRoot();
const OUT_DIR = join(REPO_ROOT, ".needle-agent");
const AGENT_DIR = join(REPO_ROOT, "apps/agent");
const DEFAULT_WORKSPACE = join(AGENT_DIR, "solution");

/** The seven required log files, in the order the console shows them. */
const LOG_FILES = [
  "prompts.log",
  "decisions.log",
  "commands.log",
  "test_runs.log",
  "errors.log",
  "human_interventions.log",
] as const;

/** Where finished runs are archived — one folder per session. */
const SESSIONS_DIR = join(OUT_DIR, "sessions");

/** Per-run artifact files copied into a session folder when it is archived. */
const ARCHIVE_FILES = [
  "run.jsonl",
  "state.json",
  "checkpoint.json",
  "operator-prompts.jsonl",
  "agent_manifest.json",
  "final_report.md",
  ...LOG_FILES,
] as const;

// ---------- low-level file readers ----------

async function readText(path: string): Promise<string> {
  const file = Bun.file(path);
  return (await file.exists()) ? file.text() : "";
}

interface RunEvent {
  seq: number;
  ts: string;
  type: string;
  [key: string]: unknown;
}

/** Parse run.jsonl into ordered events; bad lines are skipped, not fatal. */
async function readRunEvents(dir = OUT_DIR): Promise<RunEvent[]> {
  const raw = await readText(join(dir, "run.jsonl"));
  const events: RunEvent[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line) as RunEvent;
      if (parsed && typeof parsed.type === "string") events.push(parsed);
    } catch {
      // a half-written final line during a live run — ignore it
    }
  }
  return events;
}

interface StateFile {
  updatedAt: string;
  phase: Phase;
  iteration: number;
  maxIterations: number;
  bestScore: number;
  noImprovementStreak: number;
  lastScore: number | null;
  lastTotal: number | null;
  totalInputTokens: number;
  totalOutputTokens: number;
  modelCalls: number;
  toolCalls: number;
  errors: number;
  done: boolean;
}

async function readState(dir = OUT_DIR): Promise<StateFile | null> {
  const raw = await readText(join(dir, "state.json"));
  if (!raw.trim()) return null;
  try {
    return JSON.parse(raw) as StateFile;
  } catch {
    return null;
  }
}

const str = (e: RunEvent, k: string): string => (typeof e[k] === "string" ? (e[k] as string) : "");
const num = (e: RunEvent, k: string): number => (typeof e[k] === "number" ? (e[k] as number) : 0);

// ---------- snapshot builders ----------

/** "YYYY-MM-DD HH:MM" from an ISO timestamp, in local time. */
function fmtStamp(iso: string, withSeconds = false): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = (n: number) => String(n).padStart(2, "0");
  const date = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  const time = `${p(d.getHours())}:${p(d.getMinutes())}${withSeconds ? `:${p(d.getSeconds())}` : ""}`;
  return `${date} ${time}`;
}

function groupFailing(failing: unknown): FailingCategory[] {
  if (!Array.isArray(failing)) return [];
  const counts = new Map<string, number>();
  for (const item of failing) {
    const name = String(item);
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return [...counts].map(([name, count]) => ({ name, count }));
}

/** Score progression — one point per `test_run` event in run.jsonl. */
function buildScores(events: RunEvent[]): ScorePoint[] {
  const scores: ScorePoint[] = [];
  let iter = 0;
  let prevScore: number | null = null;
  for (const e of events) {
    if (e.type === "phase_start") iter = num(e, "iteration");
    if (e.type !== "test_run") continue;
    const score = num(e, "score");
    const total = num(e, "total");
    const regressed = prevScore !== null && score < prevScore;
    scores.push({
      iter,
      timestamp: fmtStamp(e.ts),
      score,
      total,
      suite: str(e, "source") === "official" ? "official suite" : "spec-derived self-tests",
      regressed,
      failingCategories: groupFailing(e.failing),
    });
    prevScore = score;
  }
  return scores;
}

const TOOL_TIMELINE_TYPE: Record<string, TimelineType> = {
  write_file: "edit",
  edit_file: "edit",
  read_file: "cmd",
  list_dir: "cmd",
  run_command: "cmd",
};

/** Agent activity feed — run.jsonl events mapped to timeline rows, newest first. */
function buildTimeline(events: RunEvent[]): TimelineEvent[] {
  const rows: TimelineEvent[] = [];
  for (const e of events) {
    const ts = fmtStamp(e.ts, true);
    switch (e.type) {
      case "run_start":
        rows.push({
          ts,
          type: "decide",
          summary: `Run started · model ${str(e, "model")}`,
          meta: str(e, "spec"),
          detail: `Workspace: ${str(e, "workspace")}\nMax iterations: ${num(e, "maxIterations")}`,
        });
        break;
      case "phase_start":
        rows.push({
          ts,
          type: "decide",
          summary: `Entered ${str(e, "phase")} phase`,
          meta: `iter ${num(e, "iteration")}`,
          detail: null,
        });
        break;
      case "plan":
        rows.push({
          ts,
          type: "plan",
          summary: `Plan accepted · ${num(e, "steps")} steps`,
          meta: `entry ${str(e, "entrypoint")}`,
          detail: `Run command: ${str(e, "runCommand")}`,
        });
        break;
      case "self_tests":
        rows.push({
          ts,
          type: "decide",
          summary: `Generated ${num(e, "count")} spec-derived test cases`,
          meta: "GENERATE_TESTS",
          detail: null,
        });
        break;
      case "tool_call": {
        const tool = str(e, "tool");
        const ok = e.ok === true;
        rows.push({
          ts,
          type: ok ? (TOOL_TIMELINE_TYPE[tool] ?? "cmd") : "fail",
          summary: `${tool} · ${str(e, "summary")}`,
          meta: ok ? "ok" : "failed",
          detail: null,
        });
        break;
      }
      case "test_run": {
        const score = num(e, "score");
        const total = num(e, "total");
        rows.push({
          ts,
          type: score === total && total > 0 ? "test" : "fail",
          summary: `Test run · ${score}/${total} on ${str(e, "source")} suite`,
          meta: `${score}/${total}`,
          detail: Array.isArray(e.failing) && e.failing.length > 0
            ? `Failing: ${(e.failing as unknown[]).join(", ")}`
            : "All cases passed",
        });
        break;
      }
      case "score_improved":
        rows.push({
          ts,
          type: "decide",
          summary: `New best score · ${num(e, "score")}/${num(e, "total")}`,
          meta: `best ${num(e, "bestScore")}`,
          detail: null,
        });
        break;
      case "error":
        rows.push({
          ts,
          type: "error",
          summary: str(e, "what") || "Agent error",
          meta: str(e, "errorType"),
          detail: null,
        });
        break;
      case "operator_prompt":
        rows.push({
          ts,
          type: "human",
          summary: `Operator nudge: ${str(e, "text")}`,
          meta: e.intervention === true ? "intervention" : "nudge",
          detail: null,
        });
        break;
      // model_call / self_tests_seeded are intentionally not surfaced as rows —
      // their totals show in the run stats instead of flooding the feed.
    }
  }
  // human-intervention rows come from human_interventions.log (see buildTimeline caller)
  return rows.reverse();
}

/** Human-intervention timeline rows, parsed from the real log file. */
function humanTimeline(humanLog: string): TimelineEvent[] {
  const rows: TimelineEvent[] = [];
  // Entries look like: "[YYYY-MM-DD HH:MM:SS] TYPE" followed by detail lines.
  const re = /^\[(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\]\s+(.+)$/;
  const lines = humanLog.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i]?.match(re);
    if (!m) continue;
    const detail: string[] = [];
    for (let j = i + 1; j < lines.length && lines[j] && !re.test(lines[j] ?? ""); j++) {
      if ((lines[j] ?? "").trim()) detail.push(lines[j] ?? "");
    }
    rows.push({
      ts: m[1] ?? "",
      type: "human",
      summary: detail[0] ? detail[0].replace(/^What happened:\s*/i, "") : (m[2] ?? "Intervention"),
      meta: (m[2] ?? "").toLowerCase(),
      detail: detail.join("\n") || null,
    });
  }
  return rows;
}

/** Live workspace listing — the files the agent actually created / edited. */
function buildFiles(events: RunEvent[], workspaceDir: string): WorkspaceFile[] {
  if (!existsSync(workspaceDir)) return [];

  const skip = new Set([".git", "node_modules", "__pycache__", ".venv", "dist"]);
  const rels: string[] = [];
  const walk = (dir: string, prefix: string) => {
    let names: string[];
    try {
      names = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of names) {
      if (skip.has(name) || name.startsWith(".")) continue;
      const full = join(dir, name);
      const rel = prefix ? `${prefix}/${name}` : name;
      let st: Stats;
      try {
        st = statSync(full);
      } catch {
        continue;
      }
      if (st.isDirectory()) walk(full, rel);
      else if (st.isFile()) rels.push(rel);
    }
  };
  walk(workspaceDir, "");
  rels.sort((a, b) => a.localeCompare(b));

  // Count write / edit tool calls per file to label created vs edited.
  const editHits = new Map<string, number>();
  for (const e of events) {
    if (e.type !== "tool_call") continue;
    const tool = str(e, "tool");
    if (tool !== "write_file" && tool !== "edit_file") continue;
    const summary = str(e, "summary");
    for (const rel of rels) {
      const base = rel.split("/").pop() ?? rel;
      if (summary.includes(base)) {
        editHits.set(rel, (editHits.get(rel) ?? 0) + (tool === "edit_file" ? 2 : 1));
      }
    }
  }

  const files: WorkspaceFile[] = [];
  for (const rel of rels) {
    let content = "";
    try {
      content = Bun.file(join(workspaceDir, rel)).size > 256_000
        ? "(file too large to display)"
        : "";
    } catch {
      content = "";
    }
    files.push({
      path: rel,
      status: (editHits.get(rel) ?? 0) >= 2 ? "edited" : "created",
      added: 0,
      removed: 0,
      hasSnapshot: false,
      rolledBack: false,
      content,
    });
  }
  return files;
}

/** Fill in file contents + line counts (async, kept out of the sync walk). */
async function hydrateFiles(files: WorkspaceFile[], workspaceDir: string): Promise<void> {
  for (const f of files) {
    if (f.content) continue; // already flagged too-large
    const text = await readText(join(workspaceDir, f.path));
    f.content = text;
    f.added = text.trim() ? text.replace(/\n$/, "").split("\n").length : 0;
  }
}

function defaultManifest(model: string): Manifest {
  return {
    primary_model: model || "openai/gpt-oss-120b",
    provider: "OpenRouter",
    additional_models: [],
    paid_usage: { paid_inference: true, paid_apis: false, paid_tools: false },
    hardware: hardwareLabel(),
    offline: false,
  };
}

function hardwareLabel(): string {
  const cpu = cpus()[0]?.model ?? "unknown CPU";
  const gb = Math.round(totalmem() / 1024 ** 3);
  return `${cpu} · ${gb} GB · ${process.platform} ${process.arch}`;
}

interface ManifestFile {
  primary_model?: string;
  provider?: string;
  additional_models?: string[];
  paid_frontier_models_used_after_spec_release?: boolean;
  institutional_or_work_model_quota_used_after_spec_release?: boolean;
  copilot_or_paid_ide_assistant_used_after_spec_release?: boolean;
  paid_inference_api_used?: boolean;
}

/** Read the real agent_manifest.json, mapping its disclosure fields. */
async function buildManifest(model: string, dir = OUT_DIR): Promise<Manifest> {
  const candidates = [join(dir, "agent_manifest.json"), join(AGENT_DIR, "agent_manifest.json")];
  for (const path of candidates) {
    const raw = await readText(path);
    if (!raw.trim()) continue;
    try {
      const m = JSON.parse(raw) as ManifestFile;
      return {
        primary_model: m.primary_model || model || "openai/gpt-oss-120b",
        provider: m.provider || "OpenRouter",
        additional_models: m.additional_models ?? [],
        paid_usage: {
          paid_inference: m.paid_inference_api_used ?? false,
          paid_apis: m.institutional_or_work_model_quota_used_after_spec_release ?? false,
          paid_tools: m.copilot_or_paid_ide_assistant_used_after_spec_release ?? false,
        },
        hardware: hardwareLabel(),
        offline: (m.provider ?? "OpenRouter").toLowerCase() === "ollama",
      };
    } catch {
      // fall through to the next candidate / default
    }
  }
  return defaultManifest(model);
}

/** Submission-readiness checklist, derived from real artifacts on disk. */
function buildChecklist(
  events: RunEvent[],
  state: StateFile | null,
  scores: ScorePoint[],
  logs: Logs,
  manifest: Manifest,
  reportExists: boolean,
  manifestExists: boolean,
): ChecklistItem[] {
  const runStart = events.find((e) => e.type === "run_start");
  const plan = events.find((e) => e.type === "plan");
  const selfTests = events.find((e) => e.type === "self_tests");
  const interventionLines = (logs["human_interventions.log"] ?? []).filter((l) =>
    /^\[\d{4}-\d{2}-\d{2}/.test(l),
  ).length;
  const noPaid =
    !manifest.paid_usage.paid_inference &&
    !manifest.paid_usage.paid_apis &&
    !manifest.paid_usage.paid_tools;
  const last = scores.at(-1);

  return [
    {
      label: "Specification loaded",
      ok: !!runStart,
      warn: false,
      meta: runStart ? str(runStart, "spec") : "no run yet",
    },
    {
      label: "Implementation plan produced",
      ok: !!plan,
      warn: false,
      meta: plan ? `${num(plan, "steps")} steps` : "pending",
    },
    {
      label: "Spec-derived tests generated",
      ok: !!selfTests,
      warn: false,
      meta: selfTests ? `${num(selfTests, "count")} cases` : "pending",
    },
    {
      label: "Public test run recorded",
      ok: scores.length > 0,
      warn: false,
      meta: last ? `${scores.length} runs · last ${last.score}/${last.total}` : "no runs",
    },
    {
      label: "Final report generated",
      ok: reportExists,
      warn: !reportExists,
      meta: reportExists ? "final_report.md" : "not generated",
    },
    {
      label: "Model manifest present",
      ok: manifestExists,
      warn: !manifestExists,
      meta: manifestExists ? "agent_manifest.json" : "using defaults",
    },
    {
      label: "Interventions log present",
      ok: !!logs["human_interventions.log"],
      warn: false,
      meta: `${interventionLines} logged ${interventionLines === 1 ? "entry" : "entries"}`,
    },
    {
      label: "No paid models after spec release",
      ok: noPaid && manifestExists,
      warn: !manifestExists,
      meta: noPaid ? "all disclosures NO" : "paid usage flagged",
    },
    {
      label: "Run completed",
      ok: state?.phase === "DONE",
      warn: !state || (state.phase !== "DONE" && state.phase !== "FAILED"),
      meta: state ? `phase ${state.phase}` : "not started",
    },
  ];
}

// ---------- live agent process ----------

interface AgentProcess {
  proc: Bun.Subprocess;
  paused: boolean;
}

// Stash on globalThis so the reference survives `bun --hot` reloads.
const procSlot = globalThis as typeof globalThis & {
  __needleAgentProc?: AgentProcess | null;
  __needleStoppedAt?: number;
};

/** Window (ms) used both for run.jsonl liveness and post-Stop suppression. */
const LIVE_WINDOW_MS = 240_000;

function liveProc(): AgentProcess | null {
  const p = procSlot.__needleAgentProc;
  if (!p) return null;
  // exitCode stays null while the process runs — including while SIGSTOP-paused.
  if (p.proc.exitCode !== null) {
    procSlot.__needleAgentProc = null;
    return null;
  }
  return p;
}

// ---------- snapshot assembly ----------

function nextDeadline(): string {
  const override = process.env.NEEDLE_DEADLINE;
  if (override && !Number.isNaN(new Date(override).getTime())) {
    return new Date(override).toISOString();
  }
  // Default: the upcoming Friday at 12:00 local time.
  const d = new Date();
  const daysToFri = (5 - d.getDay() + 7) % 7;
  d.setDate(d.getDate() + daysToFri);
  d.setHours(12, 0, 0, 0);
  if (d.getTime() < Date.now()) d.setDate(d.getDate() + 7);
  return d.toISOString();
}

function buildRun(
  state: StateFile | null,
  runStart: RunEvent | undefined,
  lastTs: string | null,
  isLive: boolean,
): RunState {
  // An archived session is frozen history — never live.
  const proc = isLive ? liveProc() : null;
  // A run counts as live when we still hold its process handle, or — as a
  // restart-proof fallback — when run.jsonl is still being appended to and no
  // terminal phase has been reached. The fallback is suppressed briefly after
  // an explicit Stop so the UI reflects that immediately.
  const lastEventAge = lastTs ? Date.now() - new Date(lastTs).getTime() : Number.POSITIVE_INFINITY;
  const recentlyStopped =
    procSlot.__needleStoppedAt != null && Date.now() - procSlot.__needleStoppedAt < LIVE_WINDOW_MS;
  const eventsFresh =
    isLive && state != null && !state.done && lastEventAge < LIVE_WINDOW_MS && !recentlyStopped;
  return {
    phase: state?.phase ?? null,
    iteration: state?.iteration ?? 0,
    maxIterations: state?.maxIterations ?? (runStart ? num(runStart, "maxIterations") : 0),
    startedAt: runStart?.ts ?? null,
    completedAt: state?.done ? (state.updatedAt ?? lastTs) : null,
    model: runStart ? str(runStart, "model") : "",
    running: proc !== null || eventsFresh,
    paused: proc?.paused ?? false,
    stuck: (state?.noImprovementStreak ?? 0) >= 3,
  };
}

export async function getSnapshot(sessionId?: string): Promise<AgentSnapshot> {
  // No sessionId => the live run in flat .needle-agent/. A sessionId => a
  // frozen, read-only archived run under .needle-agent/sessions/<id>/.
  const isLive = !sessionId;
  const dir = sessionId ? join(SESSIONS_DIR, sessionId) : OUT_DIR;
  const [events, state] = await Promise.all([readRunEvents(dir), readState(dir)]);
  const runStart = events.find((e) => e.type === "run_start");

  // Logs — the seven required files.
  const logs: Logs = {};
  await Promise.all(
    LOG_FILES.map(async (name) => {
      const raw = await readText(join(dir, name));
      if (raw) logs[name] = raw.replace(/\n$/, "").split("\n");
    }),
  );

  const scores = buildScores(events);
  const timeline = [
    ...humanTimeline(logs["human_interventions.log"]?.join("\n") ?? ""),
    ...buildTimeline(events),
  ].sort((a, b) => (a.ts < b.ts ? 1 : a.ts > b.ts ? -1 : 0));

  // An archived session keeps its workspace under <session>/workspace; a live
  // run uses the path recorded in its run_start event.
  const workspaceDir = sessionId
    ? join(dir, "workspace")
    : runStart
      ? str(runStart, "workspace") || DEFAULT_WORKSPACE
      : DEFAULT_WORKSPACE;
  const files = buildFiles(events, workspaceDir);
  await hydrateFiles(files, workspaceDir);

  const model = runStart ? str(runStart, "model") : "";
  const manifestExists =
    existsSync(join(dir, "agent_manifest.json")) || existsSync(join(AGENT_DIR, "agent_manifest.json"));
  const manifest = await buildManifest(model, dir);

  const report = await readText(join(dir, "final_report.md"));
  const reportExists = report.trim().length > 0;

  const stats: RunStats = {
    modelCalls: state?.modelCalls ?? 0,
    toolCalls: state?.toolCalls ?? 0,
    inputTokens: state?.totalInputTokens ?? 0,
    outputTokens: state?.totalOutputTokens ?? 0,
    errors: state?.errors ?? 0,
  };

  const lastTs = events.at(-1)?.ts ?? null;

  return {
    run: buildRun(state, runStart, lastTs, isLive),
    stats,
    scores,
    timeline,
    logs,
    files,
    manifest,
    checklist: buildChecklist(events, state, scores, logs, manifest, reportExists, manifestExists),
    report: reportExists ? report : null,
    deadline: nextDeadline(),
    updatedAt: new Date().toISOString(),
  };
}

/** Summaries of all archived sessions, newest first. */
export async function listSessions(): Promise<SessionSummary[]> {
  if (!existsSync(SESSIONS_DIR)) return [];
  const ids = readdirSync(SESSIONS_DIR).filter((name) => {
    try {
      return statSync(join(SESSIONS_DIR, name)).isDirectory();
    } catch {
      return false;
    }
  });
  const sessions = await Promise.all(
    ids.map(async (id): Promise<SessionSummary> => {
      const dir = join(SESSIONS_DIR, id);
      const [state, events] = await Promise.all([readState(dir), readRunEvents(dir)]);
      const runStart = events.find((e) => e.type === "run_start");
      return {
        id,
        phase: state?.phase ?? null,
        iteration: state?.iteration ?? 0,
        score: state?.lastScore ?? null,
        total: state?.lastTotal ?? null,
        startedAt: runStart?.ts ?? null,
        completedAt: state?.done ? state.updatedAt : null,
      };
    }),
  );
  return sessions.sort((a, b) => (a.id < b.id ? 1 : -1));
}

// ---------- operator actions ----------

function stamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `[${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}]`;
}

/**
 * Append a prompt to operator-prompts.jsonl — the queue the agent drains at
 * the start of every iteration (see apps/agent/src/operator.ts). This is the
 * real delivery path: when the agent drains the queue it logs the prompt to
 * prompts.log, records the intervention, and emits the run event itself.
 */
async function enqueueOperatorPrompt(text: string, intervention: boolean): Promise<void> {
  const path = join(OUT_DIR, "operator-prompts.jsonl");
  const existing = await readText(path);
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    text: text.trim(),
    intervention,
    refs: [] as string[],
  });
  await Bun.write(path, `${existing}${existing && !existing.endsWith("\n") ? "\n" : ""}${line}\n`);
}

export async function logIntervention(entry: InterventionInput): Promise<AgentSnapshot> {
  const lines = [
    `${stamp()} ${entry.type.toUpperCase()}`,
    `What happened: ${entry.what}`,
    `Why: ${entry.why}`,
    `Files or settings affected: ${entry.files || "(none)"}`,
    `Touched final task code: ${entry.touched ? "YES" : "NO"}`,
  ];
  if (entry.notes.trim()) lines.push(`Notes: ${entry.notes.trim()}`);

  const path = join(OUT_DIR, "human_interventions.log");
  let existing = await readText(path);
  // Drop the "no interventions" sentinel once a real entry is recorded.
  existing = existing.replace(/^No human interventions after hidden task release\.\s*$/m, "").trimEnd();
  await Bun.write(path, `${existing}\n\n${lines.join("\n")}\n`);

  return getSnapshot();
}

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY ?? "";
const AGENT_MODEL = process.env.AGENT_MODEL ?? "openai/gpt-oss-120b";

const openrouter = createOpenRouter({ apiKey: OPENROUTER_API_KEY });

/** Best-effort live preview: ask the model how it would act on a nudge.
 *  Only attempted when no run is active — during a run the model is busy. */
async function askAgent(prompt: string, context: string, model: string): Promise<PromptResult> {
  if (!OPENROUTER_API_KEY) {
    return {
      reply:
        "Queued for the agent. No live preview was generated — OPENROUTER_API_KEY is not configured for the console — but the prompt will be applied at the next iteration.",
      model: "",
    };
  }
  try {
    const { text } = await generateText({
      model: openrouter(model),
      abortSignal: AbortSignal.timeout(45_000),
      temperature: 0.2,
      system:
        "You are an autonomous coding agent being observed in an operator console. " +
        "An operator just sent you a nudge. Reply in first person, 2-4 sentences, " +
        "describing concretely how you will act on it at the next iteration boundary. " +
        `Current run context: ${context}`,
      messages: [{ role: "user", content: prompt }],
    });
    const reply = text.trim();
    return reply
      ? { reply, model }
      : {
          reply: "Queued for the agent — it will be applied as a nudge at the next iteration.",
          model: "",
        };
  } catch (err) {
    const aborted =
      err instanceof Error && (err.name === "AbortError" || err.name === "TimeoutError");
    return {
      reply: aborted
        ? "Queued for the agent. The live preview timed out — the model did not respond in time — but the prompt is in the queue and will be applied at the next iteration."
        : "Queued for the agent. OpenRouter could not be reached for a live preview; the prompt is still queued and will be applied at the next iteration.",
      model: "",
    };
  }
}

export async function sendPrompt(input: PromptInput): Promise<{ snapshot: AgentSnapshot; result: PromptResult }> {
  // Deliver the prompt by appending it to the operator-prompts queue. The agent
  // drains this queue at the start of every iteration and logs / acts on it
  // itself — so this one append is the whole delivery.
  await enqueueOperatorPrompt(input.text, input.intervention);

  const snapshot = await getSnapshot();

  // During a run the agent saturates the local model, so a live-preview reply
  // would only time out. Return immediately — the prompt is already queued.
  if (snapshot.run.running) {
    return {
      snapshot,
      result: {
        reply:
          "Queued for the agent. It is in the operator-prompts queue and will be applied as a high-priority nudge at the next iteration boundary. No live preview was generated because the model is busy running the current iteration.",
        model: "",
      },
    };
  }

  // No run in progress — the local model is free, so generate a live reply.
  const last = snapshot.scores.at(-1);
  const context = [
    `phase=${snapshot.run.phase ?? "idle"}`,
    `iteration=${snapshot.run.iteration}/${snapshot.run.maxIterations}`,
    `score=${last ? `${last.score}/${last.total}` : "n/a"}`,
  ].join(" ");
  const result = await askAgent(input.text, context, snapshot.run.model || AGENT_MODEL);
  return { snapshot, result };
}

function buildReport(snap: AgentSnapshot): string {
  const last = snap.scores.at(-1);
  const peak = snap.scores.reduce((m, s) => Math.max(m, s.score), 0);
  const regressions = snap.scores.filter((s) => s.regressed).length;
  const progression =
    snap.scores.map((s) => `- iter ${s.iter} · ${s.timestamp} — ${s.score}/${s.total}`).join("\n") ||
    "- No test runs recorded.";
  const failing = last?.failingCategories.length
    ? last.failingCategories.map((c) => `- ${c.name} (${c.count})`).join("\n")
    : "- None — all tracked cases passing.";
  const interventions = (snap.logs["human_interventions.log"] ?? []).filter((l) =>
    /^\[\d{4}-\d{2}-\d{2}/.test(l),
  ).length;

  return `# Final Report

Generated: ${new Date().toISOString()}

## Result

- Final phase: ${snap.run.phase ?? "not started"}
- Iterations: ${snap.run.iteration} / ${snap.run.maxIterations}
- Public test score: ${last ? `${last.score}/${last.total}` : "N/A"}
- Best score: ${peak}
- Regressions observed: ${regressions}
- Model: ${snap.manifest.primary_model} via ${snap.manifest.provider}

## Score progression

${progression}

## Remaining failing categories

${failing}

## Run statistics

- Model calls: ${snap.stats.modelCalls}
- Tool calls: ${snap.stats.toolCalls}
- Tokens: ${snap.stats.inputTokens} in / ${snap.stats.outputTokens} out
- Errors: ${snap.stats.errors}
- Human interventions logged: ${interventions}

## Workspace

${snap.files.map((f) => `- ${f.path} (${f.status}, ${f.added} lines)`).join("\n") || "- No files in the workspace."}

## Disclosure

- Paid inference: ${snap.manifest.paid_usage.paid_inference ? "YES" : "NO"}
- Paid APIs: ${snap.manifest.paid_usage.paid_apis ? "YES" : "NO"}
- Paid tools / IDE assistants: ${snap.manifest.paid_usage.paid_tools ? "YES" : "NO"}
- Hardware: ${snap.manifest.hardware}
`;
}

export async function regenerateReport(): Promise<AgentSnapshot> {
  const snap = await getSnapshot();
  await Bun.write(join(OUT_DIR, "final_report.md"), buildReport(snap));
  return getSnapshot();
}

// ---------- run controls ----------

/** Session id (YYYYMMDD-HHMMSS) derived from a run's ISO start timestamp. */
function sessionIdFromTs(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

/** Copy the current run's artifacts + workspace into .needle-agent/sessions/<id>. */
async function archiveCurrentRun(): Promise<void> {
  const events = await readRunEvents();
  const runStart = events.find((e) => e.type === "run_start");
  if (!runStart) return; // no real run on disk — nothing to archive

  const base = sessionIdFromTs(runStart.ts);
  let id = base;
  for (let n = 2; existsSync(join(SESSIONS_DIR, id)); n++) id = `${base}-${n}`;
  const dest = join(SESSIONS_DIR, id);
  mkdirSync(dest, { recursive: true });

  for (const f of ARCHIVE_FILES) {
    const src = join(OUT_DIR, f);
    if (!existsSync(src)) continue;
    try {
      copyFileSync(src, join(dest, f));
    } catch {
      // best effort — a missing artifact is not fatal
    }
  }
  if (existsSync(DEFAULT_WORKSPACE)) {
    try {
      cpSync(DEFAULT_WORKSPACE, join(dest, "workspace"), { recursive: true });
    } catch {
      // best effort
    }
  }
}

/** Relaunch the agent with --resume to continue the run still in .needle-agent/. */
function resumeAgent(): void {
  if (liveProc()) return; // already running
  procSlot.__needleStoppedAt = undefined;
  const proc = Bun.spawn({
    cmd: ["bun", "run", "src/main.ts", "--resume"],
    cwd: AGENT_DIR,
    stdout: "inherit",
    stderr: "inherit",
    env: process.env,
  });
  const tracked: AgentProcess = { proc, paused: false };
  procSlot.__needleAgentProc = tracked;
  void proc.exited.then(() => {
    if (procSlot.__needleAgentProc === tracked) procSlot.__needleAgentProc = null;
  });
}

async function startAgent(): Promise<void> {
  if (liveProc()) return; // already running
  procSlot.__needleStoppedAt = undefined; // a new run clears any prior Stop

  // Preserve the previous run as a session before this run overwrites it.
  await archiveCurrentRun();

  // Start a clean run: drop the previous run's structured artifacts so the
  // console reflects only this run. Human interventions and the manifest are
  // kept — they are submission artifacts, not per-run state.
  for (const f of ["run.jsonl", "state.json", "checkpoint.json", "decisions.log", "commands.log", "test_runs.log", "errors.log", "prompts.log"]) {
    const p = join(OUT_DIR, f);
    if (existsSync(p)) {
      try {
        rmSync(p);
      } catch {
        // best effort — the agent recreates these on start
      }
    }
  }

  const spec = process.env.AGENT_SPEC ?? "SPEC-pwgen.md";
  const proc = Bun.spawn({
    cmd: ["bun", "run", "src/main.ts", "--spec", spec],
    cwd: AGENT_DIR,
    stdout: "inherit",
    stderr: "inherit",
    env: process.env,
  });
  const tracked: AgentProcess = { proc, paused: false };
  procSlot.__needleAgentProc = tracked;
  void proc.exited.then(() => {
    if (procSlot.__needleAgentProc === tracked) procSlot.__needleAgentProc = null;
  });
}

export async function control(action: ControlAction): Promise<AgentSnapshot> {
  const proc = liveProc();
  switch (action) {
    case "start":
      await startAgent();
      break;
    case "pause":
      if (proc) {
        proc.proc.kill("SIGSTOP");
        proc.paused = true;
      }
      break;
    case "resume":
      if (proc) {
        proc.proc.kill("SIGCONT");
        proc.paused = false;
      }
      break;
    case "continue":
      // Relaunch a stopped-but-incomplete run from its checkpoint.
      resumeAgent();
      break;
    case "stop":
      if (proc) {
        if (proc.paused) proc.proc.kill("SIGCONT"); // can't terminate a stopped process
        proc.proc.kill("SIGTERM");
        procSlot.__needleAgentProc = null;
      }
      // Mark the stop even with no handle, so the run.jsonl-freshness
      // fallback doesn't keep reporting the run as live.
      procSlot.__needleStoppedAt = Date.now();
      break;
  }
  return getSnapshot();
}
