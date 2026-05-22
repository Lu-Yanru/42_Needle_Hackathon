# 42 Needle Hackathon

A monorepo for the Needle hackathon: an autonomous coding **agent** that reads
a spec, writes code, runs the public test suite, and iterates — plus a web
dashboard and API to drive and observe it.

📋 [The task](https://github.com/anavoronkova/42xNeedle_Hackathon/blob/main/README.md)
· [Submission requirements](docs/official_docs/SUBMISSION.md)

## Team

- **Team members:** Chuka Ezerioha, Klavdia Vashchillo, Yanru Lu, Liza Rain
- **Team name**: The Hallucinauts

## Final command

The hidden task asks for a Python CLI (`solution.py`). The agent's final
program is written to `apps/agent/solution/`:

```bash
python3 apps/agent/solution/solution.py <input_file>
```

The exact entrypoint and arguments follow the hidden specification in
[`docs/official_docs/secret_spec/SECRET_SPEC.md`](docs/official_docs/secret_spec/SECRET_SPEC.md).

## Setup

### Agent harness (TypeScript / Bun)

```bash
bun install
ollama pull qwen2.5-coder:7b   # local model used by the agent
```

### Final program (Python)

The submitted program uses **Python 3** standard library only — no
`requirements.txt` needed.

## Run the agent

```bash
bun run --filter=agent start \
  --spec docs/official_docs/secret_spec/SECRET_SPEC.md \
  --workspace apps/agent/solution
```

Flags: `--dry-run`, `--max-iter N`, `--log-dir <dir>`. See
[`apps/agent/README.md`](apps/agent/README.md) for full details.

## Agent overview

A TypeScript/Bun harness drives a local Ollama model (`qwen2.5-coder:7b`)
through a deterministic phase state machine:

```
PLANNING -> IMPLEMENTING -> TESTING -> FIXING -> TESTING -> ... -> DONE
```

`PLANNING`, `IMPLEMENTING`, and `FIXING` are model-driven and use native tool
calling (`read_file`, `write_file`, `list_dir`, `run_command`, `finish_phase`).
`TESTING` is deterministic — the harness runs the public test suite itself,
parses the score, and decides what happens next, so the model cannot react to
stale results. On a regression the workspace rolls back to the last-good
snapshot; after 3 stalled cycles the model is forced to rethink. A web
dashboard (Hono + oRPC API, React + TanStack Router frontend) reads the
structured event stream (`run.jsonl` + `state.json`) and lets operators queue
live prompts to the running agent.

## 19:45 checkpoint

Git tag: [`agent-readiness-1945`](../../tree/agent-readiness-1945) — captures
the agent setup as it existed before the hidden task was released at 20:00.

## Public test run

```bash
# from the workspace dir the agent built into
python3 docs/official_docs/secret_spec/test_runner/run.py apps/agent/solution
```

Final public score and progression are recorded in
[`.needle-agent/test_runs.log`](.needle-agent/test_runs.log) and summarized in
[`.needle-agent/final_report.md`](.needle-agent/final_report.md).

## Repository layout

```
.
├── apps/
│   ├── agent/    TypeScript/Bun agent harness + Python solution workspace
│   ├── server/   Hono + oRPC operator API (Bun)
│   └── web/      React + TanStack Router operator dashboard (Vite)
├── packages/
│   ├── api/      oRPC routers and business logic
│   ├── auth/     Better Auth configuration
│   ├── config/   shared TypeScript config
│   ├── db/       Drizzle ORM schema and client (bun:sqlite)
│   └── env/      typed, validated environment variables
├── docs/
│   └── official_docs/   hackathon rules, submission spec, secret spec
├── .needle-agent/       agent run logs (judge-facing) + structured events
└── agent_manifest.json  model and tool disclosure
```

## Submission artifacts

Per [`SUBMISSION.md`](docs/official_docs/SUBMISSION.md):

- `agent_manifest.json` — primary model, provider, additional models, paid-tool
  disclosures.
- `.needle-agent/` — the seven required logs (`prompts.log`, `decisions.log`,
  `commands.log`, `test_runs.log`, `errors.log`, `human_interventions.log`,
  `final_report.md`).
- Agent code under `apps/agent/`.
- Final program under `apps/agent/solution/`.

## Stack

- **Turborepo** — monorepo build orchestration
- **Bun** — runtime, package manager, and SQLite driver (`bun:sqlite`)
- **TypeScript** — agent, Hono, oRPC, TanStack Router, Better Auth, Drizzle ORM
- **Ollama** — local model serving (`qwen2.5-coder:7b`)
- **Python 3** — the submitted final program (stdlib only)
- **Oxlint + Oxfmt** — linting and formatting

## Scripts

Run from the repo root:

| Script | Description |
| --- | --- |
| `bun run dev` | Start all apps in development |
| `bun run dev:web` | Start only the web dashboard |
| `bun run dev:server` | Start only the operator API |
| `bun run build` | Build all apps |
| `bun run check-types` | Type-check all TypeScript packages |
| `bun run test` | Run all tests |
| `bun run check` | Lint and format with Oxlint + Oxfmt |

## Database

SQLite via Bun's built-in driver (`bun:sqlite`) with Drizzle ORM. Set
`DATABASE_URL` to a local file path (e.g. `local.db`) — keep it consistent
between `apps/server/.env` and `packages/db/.env`.

## Environment variables

Bun loads `.env` files automatically — no `dotenv` needed. Each app/package
reads its own `.env`:

- `apps/server/.env` — `DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `CORS_ORIGIN`
- `apps/web/.env` — `VITE_SERVER_URL`
- `packages/db/.env` — `DATABASE_URL` (used by Drizzle Kit)
- `apps/agent` (optional overrides) — `AGENT_MODEL`, `AGENT_NUM_CTX`,
  `AGENT_MAX_ITER`, `AGENT_TEAM_NAME`, …

## Known limitations

- The agent uses native Ollama tool calling, which depends on the local
  model's tool-call quality; smaller models occasionally emit malformed
  arguments and the turn is retried.
- The public test runner CLI/format is only known once the hidden task is
  released; `apps/agent/src/test-runner.ts` may need a small patch at reveal
  time to match the released interface.
- No paid frontier models, Copilot, or institutional model quota are used
  after the spec release — see `agent_manifest.json` for the full disclosure.
