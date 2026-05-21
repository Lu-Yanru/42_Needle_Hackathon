// CLI entrypoint: parse --log-dir and render the Ink app.
//
//   bun run start [--log-dir <dir>]
//
// Defaults to solution/.needle-agent — the agent's output directory when run
// with the default --workspace ./solution.

import { render } from "ink";
import { App } from "./App";

const DEFAULT_LOG_DIR = "solution/.needle-agent";

function parseLogDir(argv: string[]): string {
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--log-dir") return argv[i + 1] ?? DEFAULT_LOG_DIR;
  }
  return DEFAULT_LOG_DIR;
}

render(<App logDir={parseLogDir(Bun.argv.slice(2))} />);
