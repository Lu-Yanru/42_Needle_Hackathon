# agent

The Needle hackathon agent — reads a spec, writes code, runs tests, and iterates
autonomously. Part of the [needle-agent monorepo](../../README.md).

## Stack

- Python 3.13, managed with [uv](https://docs.astral.sh/uv/)

## Setup

```bash
cd apps/agent
uv sync
```

## Run

```bash
uv run python -m agent.run_agent
```

See `src/agent/run_agent.py` for available CLI options.

## Test

The tests are standalone scripts (no pytest required):

```bash
uv run python tests/test_logger.py
uv run python tests/test_tools.py
```

From the repo root, via Turborepo:

```bash
bun run test --filter=agent
```

## Layout

```
apps/agent/
├── src/agent/      llm · logger · prompts · run_agent · test_runner · tools
├── tests/          standalone test scripts
├── agent_logs/     runtime logs
├── main.py
└── pyproject.toml
```
