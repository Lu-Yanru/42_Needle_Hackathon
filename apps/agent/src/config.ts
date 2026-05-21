// Central configuration for the agent harness.
//
// Environment-driven values are validated once at startup via t3-env
// (@t3-oss/env-core) — same pattern as packages/env. Everything else is a
// fixed tuning constant. Every env var is overridable so models and limits
// can be tuned at 20:00 without code changes (a logged human intervention).

import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

const env = createEnv({
  server: {
    OLLAMA_URL: z.url().default("http://localhost:11434"),
    AGENT_MODEL: z.string().min(1).default("qwen2.5-coder:7b"),
    // Ollama defaults num_ctx to ~4k unless told otherwise — set it
    // explicitly or the model silently truncates its context.
    AGENT_NUM_CTX: z.coerce.number().int().positive().default(16384),
    AGENT_TEMPERATURE: z.coerce.number().min(0).default(0.1),
    AGENT_KEEP_ALIVE: z.string().min(1).default("30m"),
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
});

export const OLLAMA_URL = env.OLLAMA_URL;
export const MODEL = env.AGENT_MODEL;
export const NUM_CTX = env.AGENT_NUM_CTX;
export const TEMPERATURE = env.AGENT_TEMPERATURE;
export const KEEP_ALIVE = env.AGENT_KEEP_ALIVE;
export const REQUEST_TIMEOUT_MS = env.AGENT_TIMEOUT_MS;
export const MAX_ITERATIONS = env.AGENT_MAX_ITER;
export const TEST_COMMAND = env.AGENT_TEST_CMD;
export const TEAM_NAME = env.AGENT_TEAM_NAME;

// Fixed tuning constants (not environment-driven).
export const REQUEST_RETRIES = 2;
export const MAX_INNER_STEPS = 14; // tool calls allowed within one phase turn
export const NO_IMPROVEMENT_LIMIT = 3; // stalled test cycles before a forced rethink

// Output budgets — keep tool results small enough for a local model's context.
export const TOOL_OUTPUT_MAX_LINES = 200;
export const TOOL_OUTPUT_MAX_BYTES = 12_000;
export const FILE_READ_MAX_LINES = 400;
export const FILE_READ_MAX_BYTES = 24_000;
