// Top panel: agent identity, run status, and the score / token summary.

import { Box, Text } from "ink";
import { compactTokens, scoreBar } from "../format";
import type { RunStateSnapshot } from "../types";

interface StatusPanelProps {
  snapshot: RunStateSnapshot;
  model: string;
  status: string;
  statusColor: string;
  elapsed: string;
}

export function StatusPanel({ snapshot, model, status, statusColor, elapsed }: StatusPanelProps) {
  const score = snapshot.lastScore ?? 0;
  const total = snapshot.lastTotal ?? 0;
  const best = snapshot.bestScore >= 0 ? String(snapshot.bestScore) : "—";
  const progression =
    snapshot.scoreProgression.length > 0
      ? snapshot.scoreProgression.map((p) => `${p.score}/${p.total}`).join(" → ")
      : "—";

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1} width={78}>
      <Text>
        <Text bold color="cyan">
          Needle Agent
        </Text>
        <Text color="gray">{`   ${model}`}</Text>
      </Text>
      <Text>
        <Text color={statusColor}>{`● ${status}`}</Text>
        {`   Phase `}
        <Text bold>{snapshot.phase}</Text>
        {`   Iteration `}
        <Text bold>{`${snapshot.iteration}/${snapshot.maxIterations}`}</Text>
        {`   Elapsed `}
        <Text bold>{elapsed}</Text>
      </Text>
      <Text>
        {`Score  `}
        <Text bold>{`${score}/${total}  `}</Text>
        <Text color="green">{scoreBar(score, total)}</Text>
        {`   best `}
        <Text bold>{best}</Text>
      </Text>
      <Text color="gray">
        {`Tokens ${compactTokens(snapshot.totalInputTokens)} in · ${compactTokens(snapshot.totalOutputTokens)} out   Model calls ${snapshot.modelCalls}   Tools ${snapshot.toolCalls}`}
      </Text>
      <Text color="gray">{`Progress  ${progression}`}</Text>
    </Box>
  );
}
