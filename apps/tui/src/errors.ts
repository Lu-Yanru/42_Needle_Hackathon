// better-result TaggedError types for the TUI. The TUI only reads the agent's
// output files; every failure here is infrastructure (missing file, partial
// write, malformed JSON) and collapses to a safe default rather than crashing
// the render loop. See docs/error-handling.md for the classification convention.

import { TaggedError } from "better-result";

function describeCause(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/** Reading one of the agent's log files failed (missing or partially written). */
export class LogReadError extends TaggedError("LogReadError")<{
  path: string;
  message: string;
  cause: unknown;
}>() {
  constructor(args: { path: string; cause: unknown }) {
    super({
      path: args.path,
      cause: args.cause,
      message: `could not read log file "${args.path}": ${describeCause(args.cause)}`,
    });
  }
}

/** A log file's contents could not be parsed as the expected JSON shape. */
export class LogParseError extends TaggedError("LogParseError")<{
  what: string;
  message: string;
  cause: unknown;
}>() {
  constructor(args: { what: string; cause: unknown }) {
    super({
      what: args.what,
      cause: args.cause,
      message: `could not parse ${args.what}: ${describeCause(args.cause)}`,
    });
  }
}
