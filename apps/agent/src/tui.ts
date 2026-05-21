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
  console.log(`commands: /status /ref <path> /refs /clear-refs /quit`);

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: "agent> ",
  });

  let lastStatus = "";
  let pendingRefs: string[] = [];
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
    if (text === "/refs") {
      if (pendingRefs.length === 0) console.log("no pending refs");
      else console.log(`pending refs:\n- ${pendingRefs.join("\n- ")}`);
      rl.prompt();
      return;
    }
    if (text === "/clear-refs") {
      pendingRefs = [];
      console.log("cleared pending refs");
      rl.prompt();
      return;
    }
    if (text.startsWith("/ref ")) {
      const ref = text.slice(5).trim();
      if (!ref) {
        console.log("usage: /ref <path>");
      } else if (pendingRefs.includes(ref)) {
        console.log(`already added: ${ref}`);
      } else {
        pendingRefs.push(ref);
        console.log(`added ref: ${ref}`);
      }
      rl.prompt();
      return;
    }

    const prompt = await enqueueOperatorPrompt(logDir, text, true, pendingRefs);
    console.log(
      `queued prompt at ${prompt.ts}${pendingRefs.length > 0 ? ` with ${pendingRefs.length} ref(s)` : ""}`,
    );
    pendingRefs = [];
    rl.prompt();
  });

  await new Promise<void>((resolveClose) => rl.on("close", () => resolveClose()));
  return 0;
}

process.exit(await main());
