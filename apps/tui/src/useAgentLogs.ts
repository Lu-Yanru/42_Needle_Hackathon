// Polls the agent's output files and parses them into React state.
// run.jsonl  — append-only event timeline
// state.json — current-status snapshot

import { join } from "node:path";
import { Result } from "better-result";
import { useEffect, useState } from "react";
import { LogParseError, LogReadError } from "./errors";
import type { RunEvent, RunStateSnapshot } from "./types";

export interface AgentLogs {
  snapshot: RunStateSnapshot | null;
  events: RunEvent[];
  waiting: boolean;
}

export function useAgentLogs(logDir: string, intervalMs = 500): AgentLogs {
  const [logs, setLogs] = useState<AgentLogs>({ snapshot: null, events: [], waiting: true });

  useEffect(() => {
    let active = true;
    const statePath = join(logDir, "state.json");
    const runPath = join(logDir, "run.jsonl");

    const readText = async (path: string): Promise<string> => {
      // A missing file reads as empty — the agent may not have started yet.
      const read = await Result.tryPromise({
        try: () => Bun.file(path).text(),
        catch: (cause) => new LogReadError({ path, cause }),
      });
      return read.unwrapOr("");
    };

    const poll = async (): Promise<void> => {
      const stateText = await readText(statePath);
      const runText = await readText(runPath);
      if (!active) return;

      let snapshot: RunStateSnapshot | null = null;
      if (stateText.trim()) {
        const parsed = Result.try({
          try: () => JSON.parse(stateText) as RunStateSnapshot,
          catch: (cause) => new LogParseError({ what: "state.json", cause }),
        });
        if (parsed.isErr()) return; // partial write — try again next tick
        snapshot = parsed.value;
      }

      const events: RunEvent[] = [];
      for (const line of runText.split("\n")) {
        if (!line.trim()) continue;
        const parsed = Result.try({
          try: () => JSON.parse(line) as RunEvent,
          catch: (cause) => new LogParseError({ what: "run.jsonl line", cause }),
        });
        // Skip a malformed or half-written line.
        if (parsed.isOk()) events.push(parsed.value);
      }

      setLogs({ snapshot, events, waiting: snapshot === null });
    };

    void poll();
    const timer = setInterval(() => void poll(), intervalMs);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [logDir, intervalMs]);

  return logs;
}
