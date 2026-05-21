// CLI entrypoint: parse --log-dir and render the Ink app.
//
//   bun run start [--log-dir agent_logs]

import { render } from "ink";
import { App } from "./App";

function parseLogDir(argv: string[]): string {
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--log-dir") return argv[i + 1] ?? "agent_logs";
  }
  return "agent_logs";
}

render(<App logDir={parseLogDir(Bun.argv.slice(2))} />);
