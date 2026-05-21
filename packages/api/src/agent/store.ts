// In-memory store backing the Operator Console.
// Holds one mutable run snapshot plus a fixed submission deadline, and applies
// operator actions (run controls, interventions, prompts, report generation).
// When a real agent backend exists, swap these functions for agent_logs/ reads.

import { buildScenario, fmtTsLong, synthReport, type ScenarioSnapshot } from "./data";
import type { AgentSnapshot, ControlAction, InterventionInput, PromptInput, PromptResult, Scenario, TimelineEvent } from "./types";

// Friday 12:00 submission deadline. Anchored once at server start to ~5.5h out
// so the countdown visibly ticks and crosses into its "urgent" state.
const DEADLINE = new Date(Date.now() + 5 * 3600 * 1000 + 28 * 60 * 1000).toISOString();

let current: ScenarioSnapshot = buildScenario("climbing");

function withMeta(): AgentSnapshot {
  return { ...current, deadline: DEADLINE, updatedAt: new Date().toISOString() };
}

export function getSnapshot(): AgentSnapshot {
  return withMeta();
}

export function setScenario(scenario: Scenario): AgentSnapshot {
  current = buildScenario(scenario);
  return withMeta();
}

export function control(action: ControlAction): AgentSnapshot {
  switch (action) {
    case "start":
      current = buildScenario("climbing");
      break;
    case "pause":
      current = { ...current, run: { ...current.run, paused: true } };
      break;
    case "resume":
      current = { ...current, run: { ...current.run, paused: false } };
      break;
    case "stop":
      current = {
        ...current,
        run: { ...current.run, running: false, paused: false, phase: "DONE" },
      };
      break;
  }
  return withMeta();
}

export function logIntervention(entry: InterventionInput): AgentSnapshot {
  const ts = fmtTsLong(new Date());
  const logLine =
    `${ts} [${entry.type}] ${entry.what}. Reason: ${entry.why}.` +
    `${entry.files ? ` Files affected: ${entry.files}.` : ""}` +
    ` Final-program code touched: ${entry.touched ? "YES" : "NO"}.` +
    `${entry.notes ? ` Notes: ${entry.notes}` : ""}`;

  const event: TimelineEvent = {
    ts,
    type: "human",
    summary: `Human intervention: ${entry.what}`,
    meta: entry.type,
    detail:
      `Type: ${entry.type}\nReason: ${entry.why}\n` +
      `Files affected: ${entry.files || "(none)"}\n` +
      `Touched final program code: ${entry.touched ? "YES" : "NO"}` +
      `${entry.notes ? `\nNotes: ${entry.notes}` : ""}`,
  };

  current = {
    ...current,
    logs: {
      ...current.logs,
      "human_interventions.log": [...(current.logs["human_interventions.log"] ?? []), logLine],
    },
    timeline: [event, ...current.timeline],
  };
  return withMeta();
}

export function sendPrompt(input: PromptInput): { snapshot: AgentSnapshot; result: PromptResult } {
  const ts = fmtTsLong(new Date());
  const oneLine = input.text.replace(/\s+/g, " ").trim();
  const truncated = oneLine.length > 110 ? `${oneLine.slice(0, 107)}...` : oneLine;

  const logs: Record<string, string[]> = {
    ...current.logs,
    "prompts.log": [...(current.logs["prompts.log"] ?? []), `${ts} [operator] ${oneLine}`],
  };
  if (input.intervention) {
    logs["human_interventions.log"] = [
      ...(current.logs["human_interventions.log"] ?? []),
      `${ts} [nudge] Operator sent prompt to agent: "${truncated}". Final-program code touched: NO.`,
    ];
  }

  const event: TimelineEvent = {
    ts,
    type: "human",
    summary: `Operator prompt: ${truncated}`,
    meta: input.intervention ? "nudge - logged" : "nudge",
    detail: `Prompt:\n${input.text}\n\nLogged as intervention: ${input.intervention ? "YES" : "NO"}`,
  };

  current = { ...current, logs, timeline: [event, ...current.timeline] };

  const result: PromptResult = {
    reply: cannedReply(input.text),
    model: current.run.model || "qwen2.5-coder:32b",
  };
  return { snapshot: withMeta(), result };
}

export function regenerateReport(): AgentSnapshot {
  current = { ...current, report: current.report ?? synthReport(current) };
  return withMeta();
}

// ---------- canned agent replies ----------
// Stands in for a live model: terse, decisive, first-person, keyword-routed.
// Replace with a local Ollama call once the agent backend is wired.

const REPLIES: { match: RegExp; reply: string }[] = [
  {
    match: /roll ?back|revert|undo/i,
    reply:
      "Acknowledged. Rolling back the last edit to the prior snapshot, then re-running the public suite to confirm we recover the previous score. One iteration to verify before I try a different approach.",
  },
  {
    match: /model|14b|smaller|faster/i,
    reply:
      "Switching the primary model for the next few iterations and logging the swap to decisions.log. I'll compare the score delta after 3 iterations and revert if the smaller model underperforms.",
  },
  {
    match: /edge[ _-]?case/i,
    reply:
      "Re-prioritizing onto the edge_cases cluster. I'll enumerate the failing inputs first, propose a guard strategy, then implement. Estimate 2 iterations to move the cluster.",
  },
  {
    match: /re-?plan|re-?read|plan from scratch|fresh plan/i,
    reply:
      "Pausing code work. Re-reading spec.md and drafting a fresh top-level plan in 3-5 bullets before touching any files. One iteration of pure planning, no edits.",
  },
  {
    match: /refactor/i,
    reply:
      "Understood. I'll draft a refactor proposal for src/eval.py first - structure and rationale only, no code - so we can decide before committing iterations to it.",
  },
  {
    match: /highest|next step|next change|priorit/i,
    reply:
      "Given the remaining time and the current failing clusters, the highest-EV move is the error_handling cluster: 8 failures, a low-risk structured-error change. Targeting that next.",
  },
];

function cannedReply(text: string): string {
  for (const { match, reply } of REPLIES) {
    if (match.test(text)) return reply;
  }
  return "Acknowledged. Will apply on the next iteration boundary. Estimating 2 iterations to evaluate impact; I'll revert if the score drops more than 5.";
}
