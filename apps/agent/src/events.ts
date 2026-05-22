// Structured event stream for the dashboard — written as plain files under
// .needle-agent/. The agent only ever writes these; the dashboard reads them.
// The agent never depends on the dashboard.
//
//   run.jsonl  — append-only, one JSON event per line (the run timeline)
//   state.json — overwritten each iteration (current-status snapshot)

import { join, resolve } from "node:path";
import { Result } from "better-result";
import { FileSystemError } from "./errors";
import type { Usage } from "./openrouter";
import type { Phase, RunState, ScorePoint } from "./state";

export interface RunEvent extends Record<string, unknown> {
  seq: number;
  ts: string;
  type: string;
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

export class EventLog {
  readonly dir: string;
  private seq = 0;

  totalInputTokens = 0;
  totalOutputTokens = 0;
  modelCalls = 0;
  toolCalls = 0;
  errors = 0;

  private constructor(dir: string) {
    this.dir = dir;
  }

  static async create(dir = ".needle-agent"): Promise<EventLog> {
    const log = new EventLog(resolve(dir));
    // Continue run.jsonl across restarts (a restart is a logged intervention).
    // A missing file reads as empty — failures collapse to "".
    const runPath = log.path("run.jsonl");
    const existing = (
      await Result.tryPromise({
        try: () => Bun.file(runPath).text(),
        catch: (cause) =>
          new FileSystemError({ operation: "read", path: runPath, cause }),
      })
    ).unwrapOr("");
    log.seq = existing.trim() ? existing.trim().split("\n").length : 0;
    return log;
  }

  private path(name: string): string {
    return join(this.dir, name);
  }

  /** Append one event to run.jsonl. */
  async emit(type: string, data: Record<string, unknown> = {}): Promise<void> {
    const event: RunEvent = {
      seq: this.seq++,
      ts: new Date().toISOString(),
      type,
      ...data,
    };
    const file = this.path("run.jsonl");
    // A missing file reads as empty — failures collapse to "".
    const existing = (
      await Result.tryPromise({
        try: () => Bun.file(file).text(),
        catch: (cause) =>
          new FileSystemError({ operation: "read", path: file, cause }),
      })
    ).unwrapOr("");
    await Bun.write(file, `${existing}${JSON.stringify(event)}\n`);
  }

  async modelCall(
    phase: Phase,
    durationMs: number,
    usage: Usage,
    toolCallCount: number,
  ): Promise<void> {
    this.modelCalls++;
    this.totalInputTokens += usage.inputTokens;
    this.totalOutputTokens += usage.outputTokens;
    await this.emit("model_call", {
      phase,
      durationMs,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      toolCalls: toolCallCount,
    });
  }

  async toolCall(name: string, ok: boolean, summary: string): Promise<void> {
    this.toolCalls++;
    await this.emit("tool_call", { tool: name, ok, summary });
  }

  async errorEvent(errorType: string, what: string): Promise<void> {
    this.errors++;
    await this.emit("error", { errorType, what });
  }

  /** Overwrite state.json with the current run snapshot. */
  async writeState(state: RunState): Promise<void> {
    const tr = state.lastTestResult;
    const snapshot: RunStateSnapshot = {
      updatedAt: new Date().toISOString(),
      phase: state.phase,
      iteration: state.iteration,
      maxIterations: state.maxIterations,
      bestScore: state.bestScore,
      noImprovementStreak: state.noImprovementStreak,
      lastScore: tr?.score ?? null,
      lastTotal: tr?.total ?? null,
      scoreProgression: state.scoreProgression,
      totalInputTokens: this.totalInputTokens,
      totalOutputTokens: this.totalOutputTokens,
      modelCalls: this.modelCalls,
      toolCalls: this.toolCalls,
      errors: this.errors,
      done: state.phase === "DONE" || state.phase === "FAILED",
    };
    await Bun.write(
      this.path("state.json"),
      `${JSON.stringify(snapshot, null, 2)}\n`,
    );
  }
}
