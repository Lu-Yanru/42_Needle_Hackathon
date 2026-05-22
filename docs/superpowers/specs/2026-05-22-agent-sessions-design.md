# Agent Sessions — Design Spec

- **Date:** 2026-05-22
- **Status:** approved — implementing
- **Context:** built on the `feat/openrouter-swap` working tree

## Overview

Each agent run becomes a persisted, identifiable **session**. Two capabilities:

1. **History** — runs are archived, not overwritten. The Operator Console can list and reopen past runs.
2. **Resume** — an incomplete run can be stopped and later continued from a full on-disk checkpoint.

## Goals

- Every run preserved under `.needle-agent/sessions/<id>/`.
- Resume the latest incomplete run from saved state (phase, plan, self-tests, workspace).
- Console: a session switcher and a Resume button.

## Non-goals (YAGNI)

- Resuming an already-archived session — only the latest/current run is resumable.
- Session rename / delete / compare.
- Concurrent runs — one agent process at a time, as today.
- Per-session workspace for the *live* run — it keeps using `apps/agent/solution`; archived sessions snapshot it.

## Storage layout

```
.needle-agent/
  run.jsonl  state.json  checkpoint.json  *.log  operator-prompts.jsonl
  agent_manifest.json  final_report.md            <- ACTIVE run (location unchanged)
  sessions/
    <id>/   run.jsonl  state.json  checkpoint.json  *.log  manifest  report  workspace/
```

- Session id = the run's start timestamp, `YYYYMMDD-HHMMSS`.
- The active run still reads/writes flat `.needle-agent/` — no disruption to the live path.

## Data model — `checkpoint.json`

`state.json` stays a display snapshot (unchanged — the console's read path is not affected).
New `checkpoint.json` holds the **full `RunState`** needed to resume:

- All scalar fields (`phase`, `iteration`, `bestScore`, `planFailures`, …).
- `lastGoodSnapshot: Map<string,string>` → serialized as a JSON object `{ path: content }`; rebuilt to a `Map` on load.
- `spec` text, `plan`, `selfTests`, `verificationCommands`, `nextVerificationIndex`, `lastRunState`, `lastTestResult` — all included.

Written every iteration, alongside `state.json`.

## Components

### Agent (`apps/agent/src`)

- `events.ts`: `writeCheckpoint(state)` → `checkpoint.json`; `loadCheckpoint(dir)` → `RunState` (object → Map).
- `loop.ts`: call `writeCheckpoint(state)` next to `writeState(state)` each iteration.
- `main.ts`: `--resume` flag. When set, load `checkpoint.json` from the output dir into `RunState`, reuse the
  existing workspace, and run the loop instead of building a fresh PLANNING state. `EventLog.create` already
  continues `run.jsonl`; loggers append.

### API (`packages/api/src`)

- `agent/store.ts`:
  - `startAgent`: before clearing `.needle-agent/`, copy the current artifacts + `apps/agent/solution/`
    into `.needle-agent/sessions/<prevId>/`; then clear and spawn fresh (as today). `prevId` from the prior
    run's `run_start` timestamp (fallback: directory mtime).
  - `resumeAgent()`: spawn the agent with `--resume` (cwd `apps/agent`) against the current `.needle-agent/`.
    No archive, no clear.
  - `listSessions()`: read `.needle-agent/sessions/*` → `{ id, phase, score, total, startedAt, completedAt }[]`,
    newest first.
  - `getSnapshot(sessionId?)`: id omitted → live `.needle-agent/`; id given → `.needle-agent/sessions/<id>/`
    (read-only). Implemented by resolving a base directory.
  - `control`: add a `"continue"` action → `resumeAgent()`.
- `routers/agent.ts`: a `listSessions` procedure; `snapshot` input gains `{ sessionId?: string }`;
  `control` enum gains `"continue"`.

### Console (`apps/web/src`)

- A **session switcher** dropdown in `StatusBar` — `listSessions()` plus a "Live" entry; selecting one sets
  `selectedSessionId`.
- The snapshot `useQuery` is keyed by `selectedSessionId`; `refetchInterval` applies only to "Live".
- A **Resume button**, shown for the Live session when `!run.running && run.phase not in {DONE, FAILED}`
  → `control("continue")`.
- An archived session renders read-only (run controls disabled).

## Resume semantics

- A run is **resumable** when it is not running and its phase is not `DONE`/`FAILED`.
- Resume = relaunch the agent on the current `.needle-agent/` with `--resume`. The agent restores `RunState`
  from `checkpoint.json` and the existing `solution/` workspace, then continues the loop from `state.phase`.
- Once a new run starts, the previous run is archived and becomes frozen, read-only history — not resumable.

## Risks

- **Checkpoint completeness** — resume only works if `checkpoint.json` faithfully restores `RunState`,
  especially the `lastGoodSnapshot` Map and `plan`/`selfTests`. Mitigated by a round-trip unit test and a
  stop/continue smoke test.
- Logger header duplication on resume (cosmetic) — acceptable.

## Testing

- **Unit:** `RunState` → `writeCheckpoint` → `loadCheckpoint` round-trips equal (including the Map).
- **Smoke:** start a run, stop mid-`IMPLEMENTING`, `continue`, confirm it resumes the same phase/iteration and
  reaches `DONE`; confirm a second start archives the first run into `sessions/`.

## Implementation order

1. Agent: checkpoint write/load + `--resume` (+ round-trip test).
2. `store.ts`: archive + `resumeAgent` + `listSessions` + `getSnapshot(sessionId)`.
3. Router: `listSessions`, `snapshot` `sessionId`, `control` `"continue"`.
4. Console: session switcher + Resume button.
5. Verify: typecheck, tests, stop/continue smoke test.
