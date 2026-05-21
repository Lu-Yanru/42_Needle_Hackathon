// Submission artifacts: agent_manifest.json and the final report body.

import { MODEL } from "./config";
import type { RunState } from "./state";

export async function writeManifest(path = "agent_manifest.json"): Promise<void> {
  const manifest = {
    team_name: process.env.AGENT_TEAM_NAME ?? "TODO: set AGENT_TEAM_NAME",
    primary_model: MODEL,
    provider: "Ollama",
    runtime_or_tool: "custom TypeScript agent harness (Bun)",
    additional_models: [],
    paid_frontier_models_used_after_spec_release: false,
    copilot_or_paid_ide_assistant_used_after_spec_release: false,
    institutional_or_work_model_quota_used_after_spec_release: false,
    model_configuration_location: "apps/agent/src/config.ts",
    notes: "No paid model access was used after the hidden task release.",
  };
  await Bun.write(path, `${JSON.stringify(manifest, null, 2)}\n`);
}

export function buildFinalReport(state: RunState): string {
  const tr = state.lastTestResult;
  const progression =
    state.scoreProgression.map((p) => `- ${p.ts} — ${p.score}/${p.total}`).join("\n") || "- N/A";
  return `# Final Report

Generated: ${new Date().toISOString()}

## Result

- Final phase: ${state.phase}
- Iterations: ${state.iteration}
- Public test score: ${tr ? `${tr.score}/${tr.total}` : "N/A"}
- Best score: ${state.bestScore >= 0 ? state.bestScore : "N/A"}
- Run command: ${state.plan?.run_command ?? "N/A"}

## Score progression

${progression}

## Agent

- Harness: custom TypeScript agent (Bun), phase machine PLANNING -> IMPLEMENTING -> TESTING -> FIXING -> DONE
- Model: ${MODEL} via Ollama (local)
- Tools: read_file, write_file, list_dir, run_command, finish_phase
- Rollback: workspace is restored to the last-good snapshot when a patch regresses the score

## Notes

best_score=${state.bestScore}, no_improvement_streak=${state.noImprovementStreak}, plan_failures=${state.planFailures}
`;
}
