// Root component: derives display values from the polled logs and lays out
// the three panels.

import { Box, Text, useApp, useInput } from "ink";
import { EventFeed } from "./components/EventFeed";
import { Footer } from "./components/Footer";
import { StatusPanel } from "./components/StatusPanel";
import { formatDuration } from "./format";
import type { RunEvent } from "./types";
import { useAgentLogs } from "./useAgentLogs";

function runStartEvent(events: RunEvent[]): RunEvent | undefined {
  return events.find((event) => event.type === "run_start");
}

export function App({ logDir }: { logDir: string }) {
  const { exit } = useApp();
  const isTty = process.stdin.isTTY ?? false;
  useInput(
    (input, key) => {
      if (input === "q" || (key.ctrl && input === "c")) exit();
    },
    { isActive: isTty },
  );

  const { snapshot, waiting, events } = useAgentLogs(logDir);

  if (waiting || snapshot === null) {
    return (
      <Box borderStyle="round" borderColor="gray" paddingX={1} width={78}>
        <Text color="gray">{`Waiting for the agent — no ${logDir}/state.json yet…`}</Text>
      </Box>
    );
  }

  const finished = snapshot.phase === "DONE" || snapshot.phase === "FAILED";
  const status =
    snapshot.phase === "DONE" ? "DONE" : snapshot.phase === "FAILED" ? "FAILED" : "RUNNING";
  const statusColor =
    snapshot.phase === "DONE" ? "green" : snapshot.phase === "FAILED" ? "red" : "yellow";

  const start = runStartEvent(events);
  const startMs = start ? new Date(start.ts).getTime() : Date.now();
  const endMs = finished ? new Date(snapshot.updatedAt).getTime() : Date.now();
  const elapsed = formatDuration(endMs - startMs);
  const model = start && typeof start.model === "string" ? start.model : "agent";

  return (
    <Box flexDirection="column">
      <StatusPanel
        snapshot={snapshot}
        model={model}
        status={status}
        statusColor={statusColor}
        elapsed={elapsed}
      />
      <EventFeed events={events} />
      <Footer snapshot={snapshot} />
    </Box>
  );
}
