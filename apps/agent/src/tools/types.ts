// Tool abstraction.
// A tool carries a zod schema (validated before execute, converted to JSON
// Schema for Ollama) and returns a structured result (content + details).

import { z } from "zod";

export interface ToolResult {
  /** Text returned to the model. */
  content: string;
  /** Structured data for logs / inspection (not sent to the model). */
  details?: unknown;
  isError?: boolean;
}

export interface AnyTool {
  name: string;
  description: string;
  jsonSchema: Record<string, unknown>;
  run(rawArgs: unknown): Promise<ToolResult>;
}

export function defineTool<S extends z.ZodType>(spec: {
  name: string;
  description: string;
  parameters: S;
  execute: (args: z.infer<S>) => Promise<ToolResult>;
}): AnyTool {
  return {
    name: spec.name,
    description: spec.description,
    jsonSchema: z.toJSONSchema(spec.parameters) as Record<string, unknown>,
    async run(rawArgs: unknown): Promise<ToolResult> {
      const parsed = spec.parameters.safeParse(rawArgs ?? {});
      if (!parsed.success) {
        const issues = parsed.error.issues
          .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
          .join("; ");
        return { content: `Invalid arguments for ${spec.name}: ${issues}`, isError: true };
      }
      try {
        return await spec.execute(parsed.data);
      } catch (err) {
        return {
          content: `Tool ${spec.name} failed: ${err instanceof Error ? err.message : String(err)}`,
          isError: true,
        };
      }
    },
  };
}
