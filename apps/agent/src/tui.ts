import { createInterface } from "node:readline";
import { join, resolve } from "node:path";
import { enqueueOperatorPrompt } from "./operator";

interface Args {
  logDir: string;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { logDir: "" };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--log-dir") args.logDir = argv[++i] ?? "";
  }
  return args;
}

function formatSnapshot(state: Record<string, unknown> | null): string {
  if (!state) return "waiting for state.json...";
  const phase = String(state.phase ?? "—");
  const iteration = String(state.iteration ?? "—");
  const maxIterations = String(state.maxIterations ?? "—");
  const bestScore = String(state.bestScore ?? "—");
  return `phase=${phase} iter=${iteration}/${maxIterations} best=${bestScore}`;
}

async function readState(logDir: string): Promise<Record<string, unknown> | null> {
  const path = join(resolve(logDir), "state.json");
  const file = Bun.file(path);
  if (!(await file.exists())) return null;
  try {
    return (await file.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function main(): Promise<number> {
  const args = parseArgs(Bun.argv.slice(2));
  const logDir = args.logDir || resolve(import.meta.dir, "../../../.needle-agent");

  console.log(`needle-agent tui`);
  console.log(`log dir: ${logDir}`);
  console.log(`type a prompt and press enter`);
  console.log(`commands: /status /quit`);

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: "agent> ",
  });

  let lastStatus = "";
  const poll = setInterval(async () => {
    const state = await readState(logDir);
    const next = formatSnapshot(state);
    if (next !== lastStatus) {
      lastStatus = next;
      process.stdout.write(`\n[status] ${next}\n`);
      rl.prompt(true);
    }
  }, 1500);

  rl.prompt();

  rl.on("line", async (line) => {
    const text = line.trim();
    if (!text) {
      rl.prompt();
      return;
    }
    if (text === "/quit" || text === "/exit") {
      clearInterval(poll);
      rl.close();
      return;
    }
    if (text === "/status") {
      const state = await readState(logDir);
      console.log(formatSnapshot(state));
      rl.prompt();
      return;
    }

    const prompt = await enqueueOperatorPrompt(logDir, text, true);
    console.log(`queued prompt at ${prompt.ts}`);
    rl.prompt();
  });

  await new Promise<void>((resolveClose) => rl.on("close", () => resolveClose()));
  return 0;
}

process.exit(await main());
