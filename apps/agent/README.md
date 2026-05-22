# agent — autonomous coding agent harness

A TypeScript agent harness (Bun) that reads a specification, plans, writes code,
runs the public test suite, and repairs failures in a loop. The model runs
through **[OpenRouter](https://openrouter.ai/)** (default `openai/gpt-oss-120b`,
an open-weight model). Part of the [needle-agent monorepo](../../README.md).

## How it works

A phase state machine:

```
PLANNING -> IMPLEMENTING -> TESTING -> FIXING -> TESTING -> ... -> DONE
```

- **PLANNING / IMPLEMENTING / FIXING** are model-driven. Each turn the model
  returns exactly one schema-validated action (`read_file`, `write_file`,
  `edit_file`, `list_dir`, `run_command`) and signals it is ready for the next
  phase with `finish_phase`.
- **TESTING** is deterministic — the harness runs the public test suite itself,
  parses the score, and decides what happens next. No model call, so the model
  cannot drift or react to stale results.
- On a score **regression**, the workspace is rolled back to the last-good
  snapshot. After 3 stalled cycles the model is forced to rethink its approach.
- A `checkpoint.json` is written as the run progresses so a stopped run can be
  continued with `--resume`.

Built on Bun's native APIs (`Bun.file`, `Bun.write`, `Bun.Glob`, `Bun.spawn`,
`fetch`) plus the Vercel AI SDK for schema-constrained model output.

## Prerequisites

Set `OPENROUTER_API_KEY` in the monorepo-root `.env` (see the root
[`.env.example`](../../.env.example)). The run fails fast at startup without it.

## Run

From the repo root:

```bash
bun install
bun run --filter=agent start --spec apps/agent/SPEC.md --workspace apps/agent/solution
```

Or from `apps/agent`:

```bash
bun run start --spec SPEC.md --workspace ./solution
```

Flags:

| Flag | Description |
| --- | --- |
| `--spec <path>` | Specification file to implement (required, unless `--resume`) |
| `--workspace <dir>` | Where the program is written (default `./solution`) |
| `--dry-run` | Run one phase, then stop |
| `--max-iter N` | Override the iteration limit |
| `--log-dir <dir>` | Override the run-output directory |
| `--test-cmd "<cmd>"` | Override the public-test command (else auto-detected) |
| `--resume` | Continue the last stopped run from `checkpoint.json` |

## Monitor a run

Open the read-only Ink dashboard in a second terminal (it tails `run.jsonl` +
`state.json` — see [`apps/tui`](../tui/README.md)):

```bash
bun run tui          # from the repo root
```

## Prompt the live agent

Open the operator console against the current run's log directory:

```bash
cd apps/agent && bun run tui
```

It defaults to the monorepo's `.needle-agent/`; pass `--log-dir <dir>` if the
agent was started with a custom `--log-dir`. Type a line and press Enter to
queue it for the next model turn. Commands: `/status` (refresh phase),
`/ref <path>` (attach a reference file to the next prompt), `/refs`,
`/clear-refs`, `/quit`. Relative ref paths resolve from the agent workspace;
absolute paths work too.

## Output

All run data is written to `.needle-agent/` at the monorepo root (override
with `--log-dir`):

- the 7 judge-facing text logs: `prompts.log`, `decisions.log`, `commands.log`,
  `test_runs.log`, `errors.log`, `human_interventions.log`, `final_report.md`
- `run.jsonl` + `state.json` — structured event stream for the dashboard
  (append-only timeline + current-status snapshot, incl. token usage)
- `checkpoint.json` — run state for `--resume`
- `agent_manifest.json` — model/tool disclosure

The program itself is written to the `--workspace` directory.

## Configuration

`src/config.ts` — model, temperature, reasoning effort, timeouts, iteration
limits. Environment-driven values are validated once at startup and are
overridable so the run can be tuned mid-event (`AGENT_MODEL`,
`AGENT_REASONING_EFFORT`, `AGENT_TIMEOUT_MS`, `AGENT_MAX_ITER`, `AGENT_TEST_CMD`,
`AGENT_TEAM_NAME`, …). See [`.env.example`](../../.env.example) for defaults.

## Layout

```
apps/agent/src/
├── main.ts            CLI entrypoint + arg parsing
├── loop.ts            phase state machine + tool-calling turn
├── openrouter.ts      OpenRouter client (AI SDK, schema-constrained output)
├── prompts.ts         system + per-phase prompts
├── state.ts           run state, plan, and action schemas
├── config.ts          tunables (env-validated at startup)
├── tools/             read_file · write_file · edit_file · list_dir · run_command · finish_phase
├── workspace.ts       path-sandboxed file ops + snapshot/restore
├── test-runner.ts     runs and parses the public test suite
├── self-tests.ts      spec-derived self tests
├── harness-helpers.ts plan normalization, verification commands, failure signals
├── checkpoint.ts      checkpoint.json save/restore (for --resume)
├── logger.ts          the 7 .needle-agent text logs
├── events.ts          run.jsonl + state.json (structured stream for the dashboard)
├── submission.ts      agent_manifest.json + final report
├── operator.ts        operator-prompt queue (operator-prompts.jsonl)
├── tui.ts             operator console (queue prompts into a live run)
├── truncate.ts        output truncation (lines + bytes)
└── errors.ts          tagged error types
```

> The public test runner CLI/format is unknown until the hidden task is
> released. `src/test-runner.ts` is expected to need a small patch then.
