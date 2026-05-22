# 42 Needle Hackathon

A monorepo for the Needle hackathon: an autonomous coding **agent** that reads a
spec, writes code, runs tests, and iterates — plus a web app, an API, and a live
terminal monitor to drive and watch it.

📋 [The task](https://github.com/anavoronkova/42xNeedle_Hackathon/blob/main/README.md)

## Layout

```
.
├── apps/
│   ├── agent/    Autonomous coding agent (TypeScript/Bun) — reads a spec,
│   │             writes code, runs tests, iterates. Model via OpenRouter.
│   ├── server/   Hono + oRPC API (Bun)
│   ├── web/      React + TanStack Router frontend (Vite)
│   └── tui/      Ink terminal dashboard — read-only live monitor of a run
├── packages/
│   ├── api/      oRPC routers and business logic
│   ├── auth/     Better Auth configuration
│   ├── config/   shared TypeScript config
│   ├── db/       Drizzle ORM schema and client (bun:sqlite)
│   └── env/      typed, validated environment variables
└── docs/         plan, tasks, and official hackathon docs
```

## Stack

- **Turborepo** — monorepo build orchestration
- **Bun** — runtime, package manager, and SQLite driver (`bun:sqlite`)
- **TypeScript** — Hono, oRPC, TanStack Router, Better Auth, Drizzle ORM, Ink
- **OpenRouter** — model provider for the agent (default `openai/gpt-oss-120b`)
- **Oxlint + Oxfmt** — linting and formatting

## Getting started

### 1. Install and configure

```bash
bun install
cp .env.example .env     # then fill in the values (see below)
```

A **single root `.env`** is the source of truth for every app — Bun loads it
automatically, and `apps/web` reads it via Vite's `envDir: "../.."`. At minimum,
set:

| Variable | Example | Used by |
| --- | --- | --- |
| `OPENROUTER_API_KEY` | from <https://openrouter.ai/keys> | agent |
| `DATABASE_URL` | `local.db` | server, db |
| `BETTER_AUTH_SECRET` | a random string, 32+ chars | server |
| `BETTER_AUTH_URL` | `http://localhost:3000` | server |
| `CORS_ORIGIN` | `http://localhost:3001` | server |
| `VITE_SERVER_URL` | `http://localhost:3000` | web |

Optional agent tuning (`AGENT_MODEL`, `AGENT_MAX_ITER`, …) is documented in
`.env.example` and [`apps/agent/README.md`](apps/agent/README.md).

### 2. Web app + API

```bash
bun run db:push      # apply the database schema
bun run dev          # start web + server
```

The web app runs at <http://localhost:3001>, the API at <http://localhost:3000>.

### 3. The agent

```bash
bun run --filter=agent start --spec apps/agent/SPEC.md --workspace apps/agent/solution
```

See [`apps/agent/README.md`](apps/agent/README.md) for flags, the phase loop,
and how to monitor or steer a run.

## Scripts

Run from the repo root:

| Script | Description |
| --- | --- |
| `bun run dev` | Start the web app and the API in development |
| `bun run dev:web` | Start only the web app |
| `bun run dev:server` | Start only the API |
| `bun run build` | Build all apps |
| `bun run typecheck` | Type-check all TypeScript packages |
| `bun run test` | Run all tests |
| `bun run check` | Lint and format with Oxlint + Oxfmt |
| `bun run tui` | Open the Ink dashboard to monitor an agent run |
| `bun run db:push` | Push the Drizzle schema to the database |
| `bun run db:generate` | Generate Drizzle migrations |
| `bun run db:migrate` | Run Drizzle migrations |
| `bun run db:studio` | Open Drizzle Studio |

The agent itself is started with `bun run --filter=agent start` (see above) —
it is not part of `bun run dev`.

## Database

SQLite via Bun's built-in driver (`bun:sqlite`) with Drizzle ORM. `DATABASE_URL`
is a local file path (e.g. `local.db`); the same value is used by the server at
runtime and by Drizzle Kit for `db:push` / migrations.

## Environment variables

Bun loads the root `.env` automatically — no `dotenv` needed. `apps/agent` and
`apps/server` start with `bun --env-file ../../.env`, and `apps/web` (Vite)
reads the same file via `envDir: "../.."`. Copy `.env.example` to `.env` and
fill it in; `.env` is gitignored.
