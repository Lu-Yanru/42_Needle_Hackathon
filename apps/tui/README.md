# tui — agent monitor

An [Ink](https://github.com/vadimdemedes/ink) (React-in-the-terminal) live
monitor for the Needle agent. Part of the [needle-agent monorepo](../../README.md).

It is a **read-only viewer**: it polls the `run.jsonl` + `state.json` files the
agent writes under `<workspace>/.needle-agent/` and renders a live dashboard. It
never writes anything and never imports agent runtime code — a crash here cannot
affect the agent or the test score.

## Run

Start the agent in one terminal, then in another:

```bash
bun run --filter=tui start -- --log-dir <workspace>/.needle-agent
```

Or from the repo root: `bun run tui` (defaults to `solution/.needle-agent`).
Press `q` to quit.

If the agent has not started yet, the TUI shows "waiting for the agent…" and
picks up the run as soon as `.needle-agent/state.json` appears.

## Layout

```
┌ Needle Agent ──────────────── model ┐   status, phase, iteration, elapsed
│ Score  ████████░░  Tokens  …        │   score bar, token usage, progression
├─────────────────────────────────────┤
│ Events  (live tail of run.jsonl)    │   phase / model / tool / test events
├─────────────────────────────────────┤
│ errors 0      q quit     updated …  │
└─────────────────────────────────────┘
```
