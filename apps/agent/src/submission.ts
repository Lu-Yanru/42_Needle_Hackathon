// Submission artifacts: agent_manifest.json and the final report body.

import { MODEL, TEAM_NAME } from "./config";
import type { RunState } from "./state";

export async function writeManifest(path = "agent_manifest.json"): Promise<void> {
  const manifest = {
    team_name: TEAM_NAME,
    primary_model: MODEL,
    provider: "OpenRouter",
    runtime_or_tool: "custom TypeScript agent harness (Bun)",
    additional_models: [],
    paid_frontier_models_used_after_spec_release: false,
    copilot_or_paid_ide_assistant_used_after_spec_release: false,
    institutional_or_work_model_quota_used_after_spec_release: false,
    paid_inference_api_used: true,
    model_configuration_location: "apps/agent/src/config.ts",
    notes:
      "Inference runs on OpenRouter (a paid inference API) using the open-weight model openai/gpt-oss-120b. No paid frontier models, Copilot or paid IDE assistants, or institutional/work model quota were used after the hidden task release.",
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
- Model: ${MODEL} via OpenRouter
- Tools: read_file, write_file, list_dir, run_command, finish_phase
- Rollback: workspace is restored to the last-good snapshot when a patch regresses the score

## Notes

best_score=${state.bestScore}, no_improvement_streak=${state.noImprovementStreak}, plan_failures=${state.planFailures}
`;
}
