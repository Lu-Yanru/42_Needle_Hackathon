// Ollama /api/chat client. Native tool calling + structured (JSON-schema)
// output, plus token-usage capture. chat() never throws — failures are
// returned as a Result.

import { Result } from "better-result";
import {
  KEEP_ALIVE,
  MODEL,
  NUM_CTX,
  OLLAMA_URL,
  REQUEST_RETRIES,
  REQUEST_TIMEOUT_MS,
  TEMPERATURE,
} from "./config";
import { OllamaError } from "./errors";

export interface ToolCall {
  function: { name: string; arguments: Record<string, unknown> };
}

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_calls?: ToolCall[];
  tool_name?: string;
}

export interface OllamaTool {
  type: "function";
  function: { name: string; description: string; parameters: unknown };
}

export interface ChatOptions {
  messages: ChatMessage[];
  tools?: OllamaTool[];
  format?: unknown;
  model?: string;
}

/** Token usage for one model call. */
export interface Usage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface ChatResult {
  message: ChatMessage;
  doneReason: string;
  usage: Usage;
  durationMs: number;
}

interface OllamaChatResponse {
  message?: ChatMessage;
  done_reason?: string;
  prompt_eval_count?: number;
  eval_count?: number;
}

export async function chat(
  options: ChatOptions,
): Promise<Result<ChatResult, OllamaError>> {
  const started = Date.now();
  const body: Record<string, unknown> = {
    model: options.model ?? MODEL,
    messages: options.messages,
    stream: false,
    keep_alive: KEEP_ALIVE,
    options: { num_ctx: NUM_CTX, temperature: TEMPERATURE },
  };
  if (options.tools && options.tools.length > 0) body.tools = options.tools;
  if (options.format !== undefined) body.format = options.format;

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
      const inputTokens = data.prompt_eval_count ?? 0;
      const outputTokens = data.eval_count ?? 0;
      return Result.ok({
        message: data.message ?? { role: "assistant", content: "" },
        doneReason: data.done_reason ?? "stop",
        usage: {
          inputTokens,
          outputTokens,
          totalTokens: inputTokens + outputTokens,
        },
        durationMs: Date.now() - started,
      });
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    } finally {
      clearTimeout(timer);
    }
  }

  return Result.err(
    new OllamaError({ message: lastError || "unknown Ollama error" }),
  );
}

/** Verify Ollama is reachable and the model is pulled. */
export async function checkOllama(
  model = MODEL,
): Promise<Result<{ detail: string }, OllamaError>> {
  const fetched = await Result.tryPromise({
    try: () => fetch(`${OLLAMA_URL}/api/tags`),
    catch: (cause) =>
      new OllamaError({
        message: `cannot reach Ollama at ${OLLAMA_URL}: ${cause instanceof Error ? cause.message : String(cause)}`,
        cause,
      }),
  });
  const res = fetched.value;
  if (!res.ok) {
    return Result.err(
      new OllamaError({ message: `Ollama responded HTTP ${res.status}` }),
    );
  }
  const data = (await res.json()) as { models?: { name: string }[] };
  const names = (data.models ?? []).map((m) => m.name);
  if (!names.some((name) => name === model || name.startsWith(`${model}`))) {
    return Result.err(
      new OllamaError({
        message: `model "${model}" is not pulled. Run: ollama pull ${model}. Available: ${names.join(", ") || "none"}`,
      }),
    );
  }
  return Result.ok({
    detail: `Ollama ready at ${OLLAMA_URL}, model ${model} available`,
  });
}
