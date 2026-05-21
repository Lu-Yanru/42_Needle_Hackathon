# 42 Needle Hackathon

A monorepo for the Needle hackathon: an autonomous coding **agent** that reads a
spec, writes code, runs tests, and iterates — plus a web app and API to drive it.

📋 [The task](https://github.com/anavoronkova/42xNeedle_Hackathon/blob/main/README.md)

## Layout

```
.
├── apps/
│   ├── agent/    Python agent — reads a spec, writes code, runs tests, iterates
│   ├── server/   Hono + oRPC API (Bun)
│   └── web/      React + TanStack Router frontend (Vite)
├── packages/
│   ├── api/      oRPC routers and business logic
│   ├── auth/     Better Auth configuration
│   ├── config/   shared TypeScript config
│   ├── db/       Drizzle ORM schema and client (bun:sqlite)
│   ├── env/      typed, validated environment variables
│   └── ui/       shared shadcn/ui components
└── docs/         plan, tasks, and official hackathon docs
```

## Stack

- **Turborepo** — monorepo build orchestration
- **Bun** — runtime, package manager, and SQLite driver (`bun:sqlite`)
- **TypeScript** — Hono, oRPC, TanStack Router, Better Auth, Drizzle ORM
- **Python 3.13** ([uv](https://docs.astral.sh/uv/)) — the agent in `apps/agent`
- **Oxlint + Oxfmt** — linting and formatting

## Getting started

### TypeScript apps (web + server)

```bash
bun install
bun run db:push      # apply the database schema
bun run dev          # start web + server
```

Web runs at http://localhost:5173, the API at http://localhost:3000.

### Python agent

```bash
cd apps/agent
uv sync
```

See [`apps/agent/README.md`](apps/agent/README.md) for details.

## Scripts

Run from the repo root:

| Script | Description |
| --- | --- |
| `bun run dev` | Start all apps in development |
| `bun run dev:web` | Start only the web app |
| `bun run dev:server` | Start only the server |
| `bun run build` | Build all apps |
| `bun run check-types` | Type-check all TypeScript packages |
| `bun run test` | Run all tests (includes the Python agent) |
| `bun run check` | Lint and format with Oxlint + Oxfmt |
| `bun run db:push` | Push the Drizzle schema to the database |
| `bun run db:generate` | Generate Drizzle migrations |
| `bun run db:migrate` | Run Drizzle migrations |
| `bun run db:studio` | Open Drizzle Studio |

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
