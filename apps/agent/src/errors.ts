// better-result TaggedError types for the agent's domain and infrastructure
// failures. See docs/error-handling.md for the classification convention.

import { TaggedError } from "better-result";

function describeCause(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/** A filesystem operation failed (read, write, list, delete). */
export class FileSystemError extends TaggedError("FileSystemError")<{
  operation: string;
  path: string;
  message: string;
  cause: unknown;
}>() {
  constructor(args: { operation: string; path: string; cause: unknown }) {
    super({
      operation: args.operation,
      path: args.path,
      cause: args.cause,
      message: `filesystem ${args.operation} failed for "${args.path}": ${describeCause(args.cause)}`,
    });
  }
}

/** A model-supplied path escaped the workspace sandbox. */
export class WorkspacePathError extends TaggedError("WorkspacePathError")<{
  path: string;
  message: string;
}>() {
  constructor(args: { path: string }) {
    super({ path: args.path, message: `path "${args.path}" escapes the workspace` });
  }
}

/** A subprocess failed to spawn or run to completion. */
export class ProcessError extends TaggedError("ProcessError")<{
  command: string;
  message: string;
  cause: unknown;
}>() {
  constructor(args: { command: string; cause: unknown }) {
    super({
      command: args.command,
      cause: args.cause,
      message: `process failed (${args.command}): ${describeCause(args.cause)}`,
    });
  }
}

/** An Ollama request failed — network, HTTP status, or timeout. */
export class OllamaError extends TaggedError("OllamaError")<{
  message: string;
  cause: unknown;
}>() {
  constructor(args: { message: string; cause?: unknown }) {
    super({ message: args.message, cause: args.cause ?? null });
  }
}

/** Text could not be parsed into the expected JSON shape. */
export class ParseError extends TaggedError("ParseError")<{
  what: string;
  message: string;
}>() {
  constructor(args: { what: string; detail?: string }) {
    super({
      what: args.what,
      message: `could not parse ${args.what}${args.detail ? `: ${args.detail}` : ""}`,
    });
  }
}

/** Union of every agent error — convenient for function signatures. */
export type AgentError =
  | FileSystemError
  | WorkspacePathError
  | ProcessError
  | OllamaError
  | ParseError;
