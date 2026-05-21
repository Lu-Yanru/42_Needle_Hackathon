// Live tail of the run.jsonl event timeline.

import { Box, Text } from "ink";
import { formatEvent } from "../format";
import type { RunEvent } from "./../types";

const MAX_ROWS = 12;
const MAX_TEXT = 58;

export function EventFeed({ events }: { events: RunEvent[] }) {
  const recent = events.slice(-MAX_ROWS);

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="gray"
      paddingX={1}
      marginTop={1}
      width={78}
    >
      <Text bold>Events</Text>
      {recent.length === 0 ? (
        <Text color="gray">(no events yet)</Text>
      ) : (
        recent.map((event) => {
          const line = formatEvent(event);
          const text =
            line.text.length > MAX_TEXT ? `${line.text.slice(0, MAX_TEXT - 1)}…` : line.text;
          return (
            <Text key={event.seq}>
              <Text color="gray">{line.time}</Text>
              {` `}
              <Text color={line.color}>{line.icon}</Text>
              {` ${text}`}
            </Text>
          );
        })
      )}
    </Box>
  );
}
