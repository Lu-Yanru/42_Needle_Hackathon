// OpenRouter client via the Vercel AI SDK. Schema-constrained structured
// generation with token-usage capture. generateStructured() never throws —
// network, HTTP, timeout, or unparseable-response failures are returned as a
// Result.

import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { generateObject, type ModelMessage } from "ai";
import { Result } from "better-result";
import type { z } from "zod";
import {
  MODEL,
  OPENROUTER_API_KEY,
  REASONING_EFFORT,
  REQUEST_RETRIES,
  REQUEST_TIMEOUT_MS,
  TEMPERATURE,
} from "./config";
import { ModelError } from "./errors";

const openrouter = createOpenRouter({ apiKey: OPENROUTER_API_KEY });

// OpenRouter extra-body: only route to backends that honour the structured-
// output request, and run gpt-oss at the configured reasoning effort.
const providerOptions = {
  openrouter: {
    provider: { require_parameters: true },
    reasoning: { effort: REASONING_EFFORT },
  },
};

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/** Token usage for one model call. */
export interface Usage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface StructuredResult<T> {
  /** The model response, already validated against the request schema. */
  object: T;
  finishReason: string;
  usage: Usage;
  durationMs: number;
}

export interface StructuredOptions<S extends z.ZodType> {
  messages: ChatMessage[];
  /** Zod schema the response must satisfy — enforced as provider structured output. */
  schema: S;
  /** Short schema label passed to the provider as extra LLM guidance. */
  schemaName?: string;
  /** Override the default model slug. */
  model?: string;
}

/**
 * Run one schema-constrained generation against OpenRouter. The AI SDK
 * validates the response against `schema`; a response that cannot satisfy it
 * surfaces as a `ModelError` rather than an invalid object.
 */
export async function generateStructured<S extends z.ZodType>(
  options: StructuredOptions<S>,
): Promise<Result<StructuredResult<z.infer<S>>, ModelError>> {
  const started = Date.now();
  const generated = await Result.tryPromise({
    try: () =>
      generateObject({
        model: openrouter(options.model ?? MODEL),
        schema: options.schema,
        schemaName: options.schemaName,
        messages: options.messages as ModelMessage[],
        temperature: TEMPERATURE,
        maxRetries: REQUEST_RETRIES,
        abortSignal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        providerOptions,
      }),
    catch: (cause) =>
      new ModelError({
        message: cause instanceof Error ? cause.message : String(cause),
        cause,
      }),
  });
  if (generated.isErr()) return Result.err(generated.error);

  const result = generated.value;
  const inputTokens = result.usage.inputTokens ?? 0;
  const outputTokens = result.usage.outputTokens ?? 0;
  return Result.ok({
    object: result.object as z.infer<S>,
    finishReason: result.finishReason,
    usage: { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens },
    durationMs: Date.now() - started,
  });
}

/** Verify the OpenRouter API key is present and valid before a run starts. */
export async function checkModel(
  model = MODEL,
): Promise<Result<{ detail: string }, ModelError>> {
  if (!OPENROUTER_API_KEY) {
    return Result.err(new ModelError({ message: "OPENROUTER_API_KEY is not set" }));
  }
  const fetched = await Result.tryPromise({
    try: () =>
      fetch("https://openrouter.ai/api/v1/key", {
        headers: { Authorization: `Bearer ${OPENROUTER_API_KEY}` },
      }),
    catch: (cause) =>
      new ModelError({
        message: `cannot reach OpenRouter: ${cause instanceof Error ? cause.message : String(cause)}`,
        cause,
      }),
  });
  if (fetched.isErr()) return Result.err(fetched.error);

  const res = fetched.value;
  if (!res.ok) {
    return Result.err(
      new ModelError({
        message:
          res.status === 401
            ? "OpenRouter API key is invalid or revoked (HTTP 401)"
            : `OpenRouter key check failed (HTTP ${res.status})`,
      }),
    );
  }
  return Result.ok({ detail: `OpenRouter ready, model ${model}` });
}
