// The tool registry available to the model: read/write files, list the
// workspace, run shell commands, and signal phase completion.

import { z } from "zod";
import {
  FILE_READ_MAX_BYTES,
  FILE_READ_MAX_LINES,
  TOOL_OUTPUT_MAX_BYTES,
  TOOL_OUTPUT_MAX_LINES,
} from "../config";
import { truncateHead, truncateTail } from "../truncate";
import type { Workspace } from "../workspace";
import { type AnyTool, defineTool } from "./types";

/** Name of the control tool the loop intercepts to end a phase. */
export const FINISH_PHASE = "finish_phase";

export interface ToolContext {
  workspace: Workspace;
  onCommand?: (command: string, exitCode: number, summary: string) => void;
}

interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  timedOut: boolean;
}

async function runShell(
  workspace: Workspace,
  command: string,
  timeoutMs: number,
): Promise<CommandResult> {
  const proc = Bun.spawn(["bash", "-lc", command], {
    cwd: workspace.root,
    stdout: "pipe",
    stderr: "pipe",
  });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    proc.kill();
  }, timeoutMs);
  try {
    // Read both streams concurrently with the exit wait to avoid pipe deadlock.
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    return { stdout, stderr, exitCode: exitCode ?? -1, timedOut };
  } finally {
    clearTimeout(timer);
  }
}

export function createTools(ctx: ToolContext): AnyTool[] {
  const { workspace } = ctx;
  return [
    defineTool({
      name: "read_file",
      description: "Read the contents of a file in the workspace.",
      parameters: z.object({
        path: z.string().describe("Path relative to the workspace root"),
      }),
      async execute({ path }) {
        const exists = await workspace.fileExists(path);
        if (exists.isErr()) return { content: exists.error.message, isError: true };
        if (!exists.value) {
          return { content: `File not found: ${path}`, isError: true };
        }
        const raw = await workspace.readFile(path);
        if (raw.isErr()) return { content: raw.error.message, isError: true };
        const t = truncateHead(raw.value, {
          maxLines: FILE_READ_MAX_LINES,
          maxBytes: FILE_READ_MAX_BYTES,
        });
        return { content: t.content || "(empty file)", details: { path, bytes: t.totalBytes } };
      },
    }),
    defineTool({
      name: "write_file",
      description: "Create or overwrite a file in the workspace with the given content. Best for initial file creation or major rewrites.",
      parameters: z.object({
        path: z.string().describe("Path relative to the workspace root"),
        content: z.string().describe("Full content of the file"),
      }),
      async execute({ path, content }) {
        const written = await workspace.writeFile(path, content);
        if (written.isErr()) return { content: written.error.message, isError: true };
        return { content: `Wrote ${content.length} characters to ${path}`, details: { path } };
      },
    }),
    defineTool({
      name: "edit_file",
      description:
        "Patch an existing file by replacing one exact snippet with another. Prefer this over write_file for small, targeted changes.",
      parameters: z.object({
        path: z.string().describe("Path relative to the workspace root"),
        search: z.string().min(1).describe("Exact text to replace"),
        replace: z.string().describe("Replacement text"),
        replace_all: z
          .boolean()
          .optional()
          .describe("Replace every occurrence instead of only the first match"),
      }),
      async execute({ path, search, replace, replace_all }) {
        const edited = await workspace.editFile(path, search, replace, replace_all ?? false);
        if (edited.isErr()) return { content: edited.error.message, isError: true };
        return {
          content: `Patched ${path} (${edited.value} replacement${edited.value === 1 ? "" : "s"})`,
          details: { path, replacements: edited.value },
        };
      },
    }),
    defineTool({
      name: "list_dir",
      description: "List every file currently in the workspace.",
      parameters: z.object({}),
      async execute() {
        const listed = await workspace.listFiles();
        if (listed.isErr()) return { content: listed.error.message, isError: true };
        const files = listed.value;
        return {
          content: files.length > 0 ? files.join("\n") : "(workspace is empty)",
          details: { count: files.length },
        };
      },
    }),
    defineTool({
      name: "run_command",
      description:
        "Run a shell command in the workspace and capture stdout, stderr, and exit code. Use it to run or inspect the program. Do NOT use it to run the public test suite — the harness runs that automatically.",
      parameters: z.object({
        command: z.string().describe("Shell command to run"),
        timeout_seconds: z
          .number()
          .optional()
          .describe("Kill the command after this many seconds (default 60)"),
      }),
      async execute({ command, timeout_seconds }) {
        const timeoutMs = Math.min(Math.max((timeout_seconds ?? 60) * 1000, 1000), 180_000);
        const res = await runShell(workspace, command, timeoutMs);
        ctx.onCommand?.(command, res.exitCode, res.timedOut ? "timed out" : `exit ${res.exitCode}`);
        const blocks = [
          `exit code: ${res.exitCode}${res.timedOut ? " (timed out)" : ""}`,
          res.stdout ? `stdout:\n${res.stdout}` : "stdout: (empty)",
          res.stderr ? `stderr:\n${res.stderr}` : "",
        ].filter(Boolean);
        const t = truncateTail(blocks.join("\n"), {
          maxLines: TOOL_OUTPUT_MAX_LINES,
          maxBytes: TOOL_OUTPUT_MAX_BYTES,
        });
        return {
          content: t.content,
          details: { command, exitCode: res.exitCode, timedOut: res.timedOut },
          isError: res.exitCode !== 0,
        };
      },
    }),
    defineTool({
      name: FINISH_PHASE,
      description:
        "Call this when the code for the current phase is complete and ready for the test suite to run.",
      parameters: z.object({
        summary: z.string().describe("One sentence describing what you changed"),
      }),
      async execute({ summary }) {
        return { content: `Phase complete: ${summary}`, details: { summary } };
      },
    }),
  ];
}
