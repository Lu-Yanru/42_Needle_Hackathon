// Pure formatting helpers — time, durations, the score bar, and turning a
// raw run.jsonl event into an icon + color + one-line description.

import type { RunEvent } from "./types";

export function clockTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "--:--:--";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "0s";
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h > 0) return `${h}h${m % 60}m`;
  if (m > 0) return `${m}m${s % 60}s`;
  return `${s}s`;
}

export function scoreBar(score: number, total: number, width = 22): string {
  if (total <= 0) return "░".repeat(width);
  const filled = Math.max(0, Math.min(width, Math.round((score / total) * width)));
  return "█".repeat(filled) + "░".repeat(width - filled);
}

export function compactTokens(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

function str(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function num(value: unknown): number {
  return typeof value === "number" ? value : 0;
}

function firstLine(value: unknown): string {
  return str(value).split("\n")[0] ?? "";
}

export interface EventLine {
  time: string;
  icon: string;
  color: string;
  text: string;
}

export function formatEvent(event: RunEvent): EventLine {
  const time = clockTime(event.ts);
  switch (event.type) {
    case "run_start":
      return { time, icon: "▶", color: "cyan", text: `run start — ${str(event.model, "agent")}` };
    case "phase_start":
      return { time, icon: "▷", color: "blue", text: `phase ${str(event.phase)}` };
    case "plan":
      return {
        time,
        icon: "✎",
        color: "blue",
        text: `plan: ${str(event.runCommand)} (${num(event.steps)} steps)`,
      };
    case "model_call":
      return {
        time,
        icon: "·",
        color: "gray",
        text: `model ${str(event.phase)} ${num(event.durationMs)}ms ${num(event.inputTokens)}→${num(event.outputTokens)} tok`,
      };
    case "tool_call": {
      const ok = event.ok === true;
      return {
        time,
        icon: ok ? "⚙" : "✗",
        color: ok ? "white" : "red",
        text: `${str(event.tool)} — ${firstLine(event.summary)}`,
      };
    }
    case "test_run": {
      const score = num(event.score);
      const total = num(event.total);
      const failing = Array.isArray(event.failing) ? event.failing.map((f) => String(f)) : [];
      return {
        time,
        icon: "●",
        color: total > 0 && score === total ? "green" : "yellow",
        text: `TESTING ${score}/${total}${failing.length > 0 ? ` (FAIL: ${failing.join(", ")})` : ""}`,
      };
    }
    case "score_improved":
      return {
        time,
        icon: "▲",
        color: "green",
        text: `score improved → ${num(event.score)}/${num(event.total)}`,
      };
    case "rollback":
      return {
        time,
        icon: "↩",
        color: "yellow",
        text: `rolled back — kept best ${num(event.bestScore)}`,
      };
    case "done":
      return {
        time,
        icon: "✓",
        color: "green",
        text: `all tests passing ${num(event.score)}/${num(event.total)}`,
      };
    case "error":
      return {
        time,
        icon: "✗",
        color: "red",
        text: `${str(event.errorType, "error")}: ${firstLine(event.what)}`,
      };
    case "run_end":
      return {
        time,
        icon: "■",
        color: "cyan",
        text: `run end — ${str(event.phase)} (${num(event.iterations)} iters)`,
      };
    case "dry_run_stop":
      return { time, icon: "■", color: "gray", text: "dry-run stop" };
    default:
      return { time, icon: "·", color: "gray", text: event.type };
  }
}
