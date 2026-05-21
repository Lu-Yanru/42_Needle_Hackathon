// CLI entrypoint: parse --log-dir and render the Ink app.
//
//   bun run start [--log-dir <dir>]
//
// Defaults to `<monorepo-root>/.needle-agent` — the agent's output directory.

import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { render } from "ink";
import { App } from "./App";

/** Walk up from this file to the monorepo root (the directory with turbo.json). */
function findRepoRoot(): string {
  let dir = import.meta.dir;
  for (let i = 0; i < 12; i++) {
    if (existsSync(join(dir, "turbo.json"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return resolve(import.meta.dir, "../../.."); // fallback: apps/<name>/src layout
}

const DEFAULT_LOG_DIR = join(findRepoRoot(), ".needle-agent");

function parseLogDir(argv: string[]): string {
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--log-dir") return argv[i + 1] ?? DEFAULT_LOG_DIR;
  }
  return DEFAULT_LOG_DIR;
}

render(<App logDir={parseLogDir(Bun.argv.slice(2))} />);
