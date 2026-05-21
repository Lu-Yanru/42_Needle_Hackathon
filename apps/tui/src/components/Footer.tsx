// Bottom line: error count, quit hint, last-update time.

import { Box, Text } from "ink";
import { clockTime } from "../format";
import type { RunStateSnapshot } from "../types";

export function Footer({ snapshot }: { snapshot: RunStateSnapshot }) {
  return (
    <Box paddingX={1} marginTop={1} width={78}>
      <Text>
        <Text color={snapshot.errors > 0 ? "red" : "gray"}>{`errors ${snapshot.errors}`}</Text>
        <Text color="gray">{`     q quit     updated ${clockTime(snapshot.updatedAt)}`}</Text>
      </Text>
    </Box>
  );
}
