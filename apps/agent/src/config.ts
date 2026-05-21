// Central configuration for the agent harness.
// Everything is overridable via environment variables so prompts / models can
// be tuned at 20:00 without code changes (each such change is a logged
// human intervention).

export const OLLAMA_URL = process.env.OLLAMA_URL ?? "http://localhost:11434";
export const MODEL = process.env.AGENT_MODEL ?? "qwen2.5-coder:7b";

// Ollama defaults num_ctx to ~4k unless told otherwise — set it explicitly or
// the model silently truncates its context.
export const NUM_CTX = Number(process.env.AGENT_NUM_CTX ?? 16384);
export const TEMPERATURE = Number(process.env.AGENT_TEMPERATURE ?? 0.1);
export const KEEP_ALIVE = process.env.AGENT_KEEP_ALIVE ?? "30m";

export const REQUEST_TIMEOUT_MS = Number(process.env.AGENT_TIMEOUT_MS ?? 180_000);
export const REQUEST_RETRIES = 2;

export const MAX_ITERATIONS = Number(process.env.AGENT_MAX_ITER ?? 40);
export const MAX_INNER_STEPS = 14; // tool calls allowed within one phase turn
export const NO_IMPROVEMENT_LIMIT = 3; // stalled test cycles before a forced rethink

// Output budgets — keep tool results small enough for a local model's context.
export const TOOL_OUTPUT_MAX_LINES = 200;
export const TOOL_OUTPUT_MAX_BYTES = 12_000;
export const FILE_READ_MAX_LINES = 400;
export const FILE_READ_MAX_BYTES = 24_000;
