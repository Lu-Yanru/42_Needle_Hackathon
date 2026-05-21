import { z } from "zod";

import * as store from "../agent/store";
import { publicProcedure } from "../index";

const scenarioSchema = z.enum(["climbing", "stuck", "done", "empty"]);

// Operator Console data + actions. Public for now — the dashboard route mirrors
// the project's currently-disabled auth; swap to protectedProcedure to re-gate.
export const agentRouter = {
  /** Live snapshot of the current run — polled by the dashboard. */
  snapshot: publicProcedure.handler(() => store.getSnapshot()),

  /** Switch the demo scenario (mock data has no live agent yet). */
  setScenario: publicProcedure
    .input(z.object({ scenario: scenarioSchema }))
    .handler(({ input }) => store.setScenario(input.scenario)),

  /** START / PAUSE / RESUME / STOP from the status bar. */
  control: publicProcedure
    .input(z.object({ action: z.enum(["start", "pause", "resume", "stop"]) }))
    .handler(({ input }) => store.control(input.action)),

  /** Append a timestamped entry to human_interventions.log. */
  logIntervention: publicProcedure
    .input(
      z.object({
        type: z.string(),
        what: z.string().min(1),
        why: z.string().min(1),
        files: z.string(),
        touched: z.boolean(),
        notes: z.string(),
      }),
    )
    .handler(({ input }) => store.logIntervention(input)),

  /** Send an operator prompt to the agent; returns the agent's reply. */
  sendPrompt: publicProcedure
    .input(z.object({ text: z.string().min(1), intervention: z.boolean() }))
    .handler(({ input }) => store.sendPrompt(input)),

  /** (Re)generate final_report.md from run data. */
  regenerateReport: publicProcedure.handler(() => store.regenerateReport()),
};
