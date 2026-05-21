# agent — autonomous coding agent harness

A TypeScript agent harness (Bun) that reads a specification, plans, writes code,
runs the public test suite, and repairs failures in a loop — using a **local
model via Ollama** only. Part of the [needle-agent monorepo](../../README.md).

## How it works

A phase state machine:

```
PLANNING -> IMPLEMENTING -> TESTING -> FIXING -> TESTING -> ... -> DONE
```

- **PLANNING / IMPLEMENTING / FIXING** are model-driven. The model calls tools
  (`read_file`, `write_file`, `list_dir`, `run_command`) and signals it is ready
  with `finish_phase`.
- **TESTING** is deterministic — the harness runs the public test suite itself,
  parses the score, and decides what happens next. No model call, so the model
  cannot drift or react to stale results.
- On a score **regression**, the workspace is rolled back to the last-good
  snapshot. After 3 stalled cycles the model is forced to rethink its approach.

Built on Bun's native APIs (`Bun.file`, `Bun.write`, `Bun.Glob`, `Bun.spawn`,
`fetch`) — no extra runtime dependencies beyond `zod`.

## Prerequisites

```bash
ollama pull qwen2.5-coder:7b      # the local model
```

## Run

From the repo root:

```bash
bun install
bun run --filter=agent start --spec <path/to/SPEC.md> --workspace ./solution
```

Or from `apps/agent`:

```bash
bun run start --spec <path/to/SPEC.md> --workspace ./solution
```

Flags: `--dry-run` (one phase, then stop), `--max-iter N`, `--log-dir <dir>`.

## Output

- `agent_logs/` — `prompts.log`, `decisions.log`, `commands.log`,
  `test_runs.log`, `errors.log`, `human_interventions.log`, `final_report.md`
- `agent_manifest.json` — model/tool disclosure
- the program itself, in the `--workspace` directory

## Configuration

`src/config.ts` — model, context size, timeouts, iteration limits. All values
are overridable via environment variables (`AGENT_MODEL`, `AGENT_NUM_CTX`,
`AGENT_MAX_ITER`, `AGENT_TEAM_NAME`, …).

## Layout

```
apps/agent/src/
├── main.ts          CLI entrypoint
├── loop.ts          phase state machine + tool-calling turn
├── ollama.ts        Ollama /api/chat client (native tool calling)
├── tools/           read_file · write_file · list_dir · run_command · finish_phase
├── workspace.ts     path-sandboxed file ops + snapshot/restore
├── logger.ts        the 7 agent_logs files
├── prompts.ts       system + per-phase prompts
├── test-runner.ts   runs and parses the public test suite
├── submission.ts    agent_manifest.json + final report
├── truncate.ts      output truncation (lines + bytes)
├── state.ts         run state + plan schema
└── config.ts        tunables
```

> The public test runner CLI/format is unknown until the hidden task is
> released. `src/test-runner.ts` is expected to need a small patch at 20:00.
