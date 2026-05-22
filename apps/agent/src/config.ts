// Central configuration for the agent harness.
//
// Environment-driven values are validated once at startup via t3-env
// (@t3-oss/env-core) — same pattern as packages/env. Everything else is a
// fixed tuning constant. Every env var is overridable so the model and limits
// can be tuned mid-event without code changes (a logged human intervention).

import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

const env = createEnv({
  server: {
    // OpenRouter API key — required; the run fails fast at startup without it.
    OPENROUTER_API_KEY: z.string().min(1),
    AGENT_MODEL: z.string().min(1).default("openai/gpt-oss-120b"),
    AGENT_TEMPERATURE: z.coerce.number().min(0).default(0.1),
    // gpt-oss is a reasoning model — higher effort trades latency for quality.
    AGENT_REASONING_EFFORT: z.enum(["low", "medium", "high"]).default("medium"),
    AGENT_TIMEOUT_MS: z.coerce.number().int().positive().default(180_000),
    AGENT_MAX_ITER: z.coerce.number().int().positive().default(40),
    // Official public-test command. Empty = auto-detect a run_tests.py under
    // secret_spec/ or toy_spec/. A literal "{program}" is replaced with the
    // program's run command.
    AGENT_TEST_CMD: z.string().default(""),
    AGENT_TEAM_NAME: z.string().default("TODO: set AGENT_TEAM_NAME"),
  },
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
  // `bun test` runs with NODE_ENV=test and never makes real model calls — skip
  // env validation there so unit tests don't need a live API key.
  skipValidation: process.env.NODE_ENV === "test",
});

export const OPENROUTER_API_KEY = env.OPENROUTER_API_KEY;
export const MODEL = env.AGENT_MODEL;
export const TEMPERATURE = env.AGENT_TEMPERATURE;
export const REASONING_EFFORT = env.AGENT_REASONING_EFFORT;
export const REQUEST_TIMEOUT_MS = env.AGENT_TIMEOUT_MS;
export const MAX_ITERATIONS = env.AGENT_MAX_ITER;
export const TEST_COMMAND = env.AGENT_TEST_CMD;
export const TEAM_NAME = env.AGENT_TEAM_NAME;

// Fixed tuning constants (not environment-driven).
export const REQUEST_RETRIES = 2;
export const MAX_INNER_STEPS = 14; // tool calls allowed within one phase turn
export const NO_IMPROVEMENT_LIMIT = 3; // stalled test cycles before a forced rethink

// Output budgets — keep tool results small enough for the model's context.
export const TOOL_OUTPUT_MAX_LINES = 200;
export const TOOL_OUTPUT_MAX_BYTES = 12_000;
export const FILE_READ_MAX_LINES = 400;
export const FILE_READ_MAX_BYTES = 24_000;
