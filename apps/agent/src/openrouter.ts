// Local Ollama client. Schema-constrained structured generation via Ollama's
// `format` parameter — the JSON schema is grammar-constrained during decoding,
// so the model cannot emit JSON that violates the schema. generateStructured()
// never throws: network, HTTP, timeout, or unparseable-response failures are
// returned as a Result.
//
// Inference is fully local and free — no cloud API, no paid access. The file
// keeps its name so the rest of the harness imports it unchanged.

import { Result } from "better-result";
import { z } from "zod";
import { MODEL, REQUEST_RETRIES, REQUEST_TIMEOUT_MS, TEMPERATURE } from "./config";
import { ModelError } from "./errors";

/** Local Ollama server. Override with OLLAMA_URL if it runs elsewhere. */
const OLLAMA_URL = process.env.OLLAMA_URL ?? "http://localhost:11434";
/** Context window — large enough for the FIXING prompt (plan + files + signal). */
const NUM_CTX = Number(process.env.AGENT_NUM_CTX ?? "16384");
/** Keep the model resident between iterations so calls don't pay reload cost. */
const KEEP_ALIVE = "30m";

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
  /** The model response, parsed and validated against the request schema. */
  object: T;
  finishReason: string;
  usage: Usage;
  durationMs: number;
}

export interface StructuredOptions<S extends z.ZodType> {
  messages: ChatMessage[];
  /** Zod schema the response must satisfy — enforced as Ollama structured output. */
  schema: S;
  /** Short schema label (unused by Ollama; accepted for call-site compatibility). */
  schemaName?: string;
  /** Override the default model slug. */
  model?: string;
}

interface OllamaChatResponse {
  message?: { role: string; content: string };
  done_reason?: string;
  prompt_eval_count?: number;
  eval_count?: number;
}

/**
 * Run one schema-constrained generation against the local Ollama server.
 * Ollama grammar-constrains the output to `schema`; the response is still
 * parsed and validated here, and a mismatch surfaces as a `ModelError`.
 */
export async function generateStructured<S extends z.ZodType>(
  options: StructuredOptions<S>,
): Promise<Result<StructuredResult<z.infer<S>>, ModelError>> {
  const started = Date.now();
  const body = {
    model: options.model ?? MODEL,
    messages: options.messages,
    stream: false,
    keep_alive: KEEP_ALIVE,
    format: z.toJSONSchema(options.schema),
    options: { num_ctx: NUM_CTX, temperature: TEMPERATURE },
  };

  let lastError = "";
  for (let attempt = 0; attempt <= REQUEST_RETRIES; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(`${OLLAMA_URL}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!res.ok) {
        lastError = `Ollama HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`;
        if (res.status >= 400 && res.status < 500) break; // client errors won't fix on retry
        continue;
      }
      const data = (await res.json()) as OllamaChatResponse;
      const content = data.message?.content ?? "";

      let parsed: unknown;
      try {
        parsed = JSON.parse(content);
      } catch {
        lastError = `Ollama returned non-JSON content: ${content.slice(0, 200)}`;
        continue;
      }
      const validated = options.schema.safeParse(parsed);
      if (!validated.success) {
        lastError = `response did not match schema: ${validated.error.message.slice(0, 200)}`;
        continue;
      }

      const inputTokens = data.prompt_eval_count ?? 0;
      const outputTokens = data.eval_count ?? 0;
      return Result.ok({
        object: validated.data as z.infer<S>,
        finishReason: data.done_reason ?? "stop",
        usage: { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens },
        durationMs: Date.now() - started,
      });
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    } finally {
      clearTimeout(timer);
    }
  }

  return Result.err(new ModelError({ message: lastError || "unknown Ollama error" }));
}

/** Verify the local Ollama server is reachable and the model is pulled. */
export async function checkModel(
  model = MODEL,
): Promise<Result<{ detail: string }, ModelError>> {
  const fetched = await Result.tryPromise({
    try: () => fetch(`${OLLAMA_URL}/api/tags`),
    catch: (cause) =>
      new ModelError({
        message: `cannot reach Ollama at ${OLLAMA_URL}: ${cause instanceof Error ? cause.message : String(cause)}`,
        cause,
      }),
  });
  if (fetched.isErr()) return Result.err(fetched.error);

  const res = fetched.value;
  if (!res.ok) {
    return Result.err(new ModelError({ message: `Ollama responded HTTP ${res.status}` }));
  }
  const data = (await res.json()) as { models?: { name: string }[] };
  const names = (data.models ?? []).map((m) => m.name);
  if (!names.some((name) => name === model || name.startsWith(model))) {
    return Result.err(
      new ModelError({
        message: `model "${model}" is not pulled. Run: ollama pull ${model}. Available: ${names.join(", ") || "none"}`,
      }),
    );
  }
  return Result.ok({ detail: `Ollama ready at ${OLLAMA_URL}, model ${model} available` });
}
