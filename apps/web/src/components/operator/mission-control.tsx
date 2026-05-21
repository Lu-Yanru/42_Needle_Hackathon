// Mission Control — the 10-panel bento grid.

import type { AgentSnapshot, InterventionInput, WorkspaceFile } from "@needle-agent/api/agent/types";
import { useState } from "react";

import { DiffModal, FinalReport, InterventionForm, LogsViewer, Manifest, Timeline, Workspace } from "./panels-bottom";
import { FailingCategories, ScoreChart, SubmissionChecklist } from "./panels-top";

interface MissionControlProps {
  snapshot: AgentSnapshot;
  onLogIntervention: (entry: InterventionInput) => Promise<void>;
  onRegenerateReport: () => void;
}

export function MissionControl({ snapshot, onLogIntervention, onRegenerateReport }: MissionControlProps) {
  const [diffFile, setDiffFile] = useState<WorkspaceFile | null>(null);

  return (
    <>
      <div className="bento">
        <ScoreChart scores={snapshot.scores} />
        <div className="col-4" style={{ display: "flex", flexDirection: "column", gap: "var(--gap)" }}>
          <FailingCategories scores={snapshot.scores} />
          <SubmissionChecklist checklist={snapshot.checklist} />
        </div>

        <Timeline events={snapshot.timeline} />
        <LogsViewer logs={snapshot.logs} />

        <Workspace files={snapshot.files} onOpenDiff={setDiffFile} />
        <InterventionForm onSubmit={onLogIntervention} />
        <Manifest manifest={snapshot.manifest} stats={snapshot.stats} />

        <FinalReport
          report={snapshot.report}
          runDone={snapshot.run.phase === "DONE"}
          onRegenerate={onRegenerateReport}
        />
      </div>

      <DiffModal file={diffFile} onClose={() => setDiffFile(null)} />
    </>
  );
}
