// Polls the agent's output files and parses them into React state.
// run.jsonl  — append-only event timeline
// state.json — current-status snapshot

import { join } from "node:path";
import { useEffect, useState } from "react";
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

    const poll = async (): Promise<void> => {
      const stateText = await Bun.file(statePath)
        .text()
        .catch(() => "");
      const runText = await Bun.file(runPath)
        .text()
        .catch(() => "");
      if (!active) return;

      let snapshot: RunStateSnapshot | null = null;
      if (stateText.trim()) {
        try {
          snapshot = JSON.parse(stateText) as RunStateSnapshot;
        } catch {
          return; // partial write — try again next tick
        }
      }

      const events: RunEvent[] = [];
      for (const line of runText.split("\n")) {
        if (!line.trim()) continue;
        try {
          events.push(JSON.parse(line) as RunEvent);
        } catch {
          // skip a malformed or half-written line
        }
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
