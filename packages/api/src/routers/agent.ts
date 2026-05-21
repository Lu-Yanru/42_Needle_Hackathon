import { z } from "zod";

import * as store from "../agent/store";
import { publicProcedure } from "../index";

// Operator Console data + actions. Every handler reads or writes the agent's
// real run artifacts under .needle-agent/ — there is no mock data path.
// Public for now; swap to protectedProcedure to re-gate behind auth.
export const agentRouter = {
  /** Live snapshot of the current run — polled by the dashboard. */
  snapshot: publicProcedure.handler(() => store.getSnapshot()),

  /** START / PAUSE / RESUME / STOP — spawns or signals the real agent process. */
  control: publicProcedure
    .input(z.object({ action: z.enum(["start", "pause", "resume", "stop"]) }))
    .handler(({ input }) => store.control(input.action)),

  /** Append a timestamped entry to the real human_interventions.log. */
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

  /** Log an operator prompt to prompts.log and return the local model's reply. */
  sendPrompt: publicProcedure
    .input(z.object({ text: z.string().min(1), intervention: z.boolean() }))
    .handler(({ input }) => store.sendPrompt(input)),

  /** (Re)generate final_report.md from the real run data. */
  regenerateReport: publicProcedure.handler(() => store.regenerateReport()),
};
