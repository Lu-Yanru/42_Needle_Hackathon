# Task Division — 19:45 Checkpoint Sprint

**Now**: 12:00, 3 members. **+1pm**: 4th member joins. **Hard stop**: 19:45 (checkpoint), 20:00 (reveal).

Roles below are *owners*, not solo workers. If you finish your slice early, jump into the next sync point. All code lands in this repo. See `PLAN.md` for the full phase-by-phase spec — this doc just maps it onto people.

______________________________________________________________________

## Quick map of who owns what

| Member | Role | Owns (files / phases) |
| ------ | --------------- | ------------------------------------------------------------------------- |
| **A** | Plumbing / LLM | `agent/llm.py`, Ollama setup, test-runner integration (Phase 0, 1a, 4b) |
| **B** | Brain / Loop | `agent/run_agent.py`, `agent/prompts.py`, state machine (Phase 1b, 3, 5a) |
| **C** | Tools / Logging | `agent/tools.py`, `agent/logger.py`, snapshots, manifest (Phase 1c, 2, 7) |
| **D** | QA / Integration (arrives 13:00) | toy spec + toy tests, dry-run harness, self-test gen, README (Phase 6, 8) |

If anyone is sick / late, **C absorbs B's prompts work**, **A absorbs C's test-runner**. Do not block on the missing person.

**If D can't make it**: split D's work by priority, drop the stretch goal.

- **Toy spec + toy tests (critical, A picks up)** — A is the downstream consumer of these for the test-runner glue, so they have to exist. ~45 min carved out of A's 15:00 - 17:00 block.
- **README + run-the-agent docs (C picks up)** — small, fits next to C's manifest/final-report work at 17:00 - 19:00.
- **Phase 6 self-test generation (drop)** — it's a stretch goal in `PLAN.md`. Skip it entirely; nobody backfills.
- **Phase 8 dry run at 19:00** — already an all-hands activity, no change needed.

______________________________________________________________________

## Timeline & sync points

| Time | Milestone | Sync? |
| ------------- | -------------------------------------------------------------------- | ----- |
| 12:00 - 13:00 | Phase 0 on every machine. A/B/C stub out their files. | - |
| **13:00** | **Sync #1** — D arrives, demo working Ollama call, hand D a task | 10 min |
| 13:00 - 15:00 | Phase 1 (loop, tools, llm wrapper) + Phase 2 (logging) in parallel | - |
| **15:00** | **Sync #2** — integrate; run "hello world" agent end-to-end | 15 min |
| 15:00 - 17:00 | Phase 3 (planner) + Phase 4 (codegen + test runner) in parallel | - |
| **17:00** | **Sync #3** — planner outputs valid JSON, test runner returns scores | 15 min |
| 17:00 - 19:00 | Phase 5 (fix loop + rollback) + Phase 6 (self-tests) + Phase 7 | - |
| 19:00 - 19:30 | **Phase 8 dry run together** — toy task end-to-end | all |
| 19:30 - 19:45 | Phase 9 — commit, tag `agent-readiness-1945`, push | all |

If a sync point slips by >20 min, drop the in-progress phase and use buffer time. **Working > complete.**

______________________________________________________________________

## Member A — Plumbing / LLM

**Goal by 19:45**: `from agent.llm import call_model` works and returns text. Test runner can be invoked.

### 12:00 - 13:00 (solo)

- [ ] Install Ollama, pull `qwen2.5-coder:7b` (and `deepseek-coder:6.7b` as fallback)
- [ ] Verify `curl http://localhost:11434/api/generate -d '{"model":"qwen2.5-coder:7b","prompt":"hi","stream":false}'` returns
- [ ] Create skeleton `agent/llm.py` with `call_model(prompt, system="") -> str`
- [ ] Write a `requirements.txt` with `requests` only

### 13:00 - 15:00

- [ ] Harden `call_model`: timeout 120s, 2 retries on connection error, surface stop reason
- [ ] Add `call_model_json(prompt, schema_hint)` that retries up to 3x if response isn't valid JSON
- [ ] Document model choice + endpoint in a 5-line comment at top of `llm.py`

### 15:00 - 17:00 (Phase 4b — test runner glue)

- [ ] Write `agent/test_runner.py`:
  - `run_public_tests(workspace, program_cmd) -> dict` with `{score, total, failing_categories, raw}`
  - Robust to missing `secret_spec/test_runner/` — return a clear error dict
- [ ] Decide on a parseable output convention with D's toy tests

### 17:00 - 19:00

- [ ] Stretch: warm fallback to `deepseek-coder:6.7b` if `qwen2.5-coder:7b` errors 3x
- [ ] Help B debug whatever the model keeps refusing to output as JSON

______________________________________________________________________

## Member B — Brain / Loop

**Goal by 19:45**: `python3 agent/run_agent.py --spec toy_spec/SPEC.md` runs the full loop on the toy task.

### 12:00 - 13:00 (solo)

- [ ] Install Ollama + venv (same as A)
- [ ] Stub `agent/run_agent.py` with the loop skeleton from `PLAN.md` Phase 1
- [ ] Stub `agent/prompts.py` with three string templates: `PLANNING`, `IMPLEMENTING`, `FIXING`

### 13:00 - 15:00 (Phase 1b)

- [ ] Build the main loop: state dict, iteration counter, action dispatch
- [ ] Define the action JSON schema: `{action, path?, content?, command?, reasoning}`
- [ ] Add `--dry-run` flag (one model call, no side effects) — needed for D's smoke tests
- [ ] Wire A's `llm.py` + C's `tools.py` (use stubs if not ready)

### 15:00 - 17:00 (Phase 3)

- [ ] Write planning prompt (see `PLAN.md` Phase 3 example)
- [ ] Add `PLANNING -> IMPLEMENTING -> TESTING -> FIXING` state machine
- [ ] Save parsed plan JSON to `agent_logs/plan.json` for inspection

### 17:00 - 19:00 (Phase 5a)

- [ ] Implement fix-loop prompt with explicit "ONE category, no full rewrite, no debug prints"
- [ ] Add anti-thrash guard: 3 consecutive no-improvement → force analysis prompt
- [ ] Coordinate with C on snapshot/rollback API

______________________________________________________________________

## Member C — Tools / Logging

**Goal by 19:45**: All 7 log files written automatically with timestamps. Snapshots + rollback work. `agent_manifest.json` generated.

### 12:00 - 13:00 (solo)

- [ ] Install Ollama + venv
- [ ] Stub `agent/tools.py` with the four functions from `PLAN.md` Phase 1
- [ ] Stub `agent/logger.py` — empty `AgentLogger` class with method signatures

### 13:00 - 15:00 (Phase 1c + Phase 2)

- [ ] Implement `tools.py`: `read_file`, `write_file`, `run_command` (capture stdout/stderr/exit_code, configurable timeout), `list_dir`
- [ ] Implement `logger.py` with all 6 log methods + `write_final_report`
- [ ] Every method prepends `[YYYY-MM-DD HH:MM:SS]`
- [ ] Logs auto-create `agent_logs/` if missing
- [ ] Create empty `agent_logs/human_interventions.log` with a comment header — this one we fill by hand

### 15:00 - 17:00 (Phase 5 rollback)

- [ ] Snapshot helper: before any `write_file`, save current content to in-memory dict keyed by path
- [ ] `restore_snapshot(path)` for B's regression-detection logic
- [ ] Test: write file → snapshot → overwrite → restore → diff is empty

### 17:00 - 19:00 (Phase 7)

- [ ] `agent/generate_submission.py`:
  - Writes `agent_manifest.json` (model name, provider=Ollama, paid=false, agent setup version, git SHA)
  - Writes `agent_logs/final_report.md` from a template + state dict
- [ ] Sanity-check: `python3 -c "import json; json.load(open('agent_manifest.json'))"` passes

______________________________________________________________________

## Member D — QA / Integration (arrives 13:00)

**Goal by 19:45**: Toy task runs end-to-end through the agent. README explains how to start the agent in one command. Self-test generation works.

### 13:00 - 13:15 (onboarding)

- [ ] Read this `TASKS.md` + `PLAN.md`
- [ ] A demos a working `call_model("hi")`
- [ ] Pull the repo, set up Ollama on your machine in the background while you start

### 13:15 - 15:00 (toy spec)

- [ ] Write `toy_spec/SPEC.md` — "CLI that reads a file, outputs `{"lines": [...], "count": N}` as JSON, exit 1 if missing"
- [ ] Write `toy_spec/test_runner/run_tests.py` — minimal test harness that:
  - takes `--program 'python3 solution.py ...'` and runs it against fixture inputs
  - prints `SCORE: X/Y` and per-category pass/fail in a format A can parse
- [ ] 5 toy tests: golden path, empty file, missing file, large file, special chars

### 15:00 - 17:00 (Phase 6 self-tests)

- [ ] Self-test generation prompt + integration with the loop (see `PLAN.md` Phase 6)
- [ ] Verify generated tests are runnable, not just syntactically valid

### 17:00 - 19:00 (dry-run harness + docs)

- [ ] Write `README.md` "How to run the agent" — single command, expected outputs, where logs land
- [ ] Build a `make smoke` (or `./scripts/smoke.sh`) that runs `--dry-run` and asserts log files exist
- [ ] Pair with B to debug the planner if it's still misbehaving

### 19:00 - 19:30 (Phase 8 — everyone)

- [ ] Drive the dry run on the toy spec. Watch all 4 terminal tabs (`tail -f agent_logs/*.log`)
- [ ] Tick off the Definition of Done checklist from `PLAN.md`

______________________________________________________________________

## Shared / parallel chores (whoever has 5 min)

- [ ] `.gitignore` additions: `.venv/`, `__pycache__/`, `agent_logs/*.log` (keep `.gitkeep`)
- [ ] Add Ollama install instructions to README
- [ ] Pre-install on every machine: `pytest`, `requests`, basic Python stdlib check
- [ ] Confirm everyone can `git push` to this repo

______________________________________________________________________

## Hard rules during the sprint

1. **Don't block waiting for someone's file** — write against a stub, integrate at the next sync.
1. **Commit small and often** on your own branch. Sync points = merge to `main`.
1. **If you spend 20 min stuck, ask in the group chat.** Don't burn an hour silently.
1. **No paid model APIs after 20:00.** That includes your school/work Copilot. Get used to Ollama *now*, not at 20:05.
1. **Log human interventions** — even pre-reveal ones during dry-runs are good practice for the real run.

______________________________________________________________________

## What "ready at 19:45" looks like (lifted from `PLAN.md` DoD)

- [ ] `python3 agent/run_agent.py --spec <path>` starts without errors
- [ ] Agent calls Ollama, gets a response
- [ ] Agent writes at least one file
- [ ] Agent runs at least one command
- [ ] Agent parses test output (toy tests count)
- [ ] All 7 log files created with timestamps
- [ ] Toy task: score improves over 3+ iterations
- [ ] `agent_manifest.json` generated correctly
- [ ] Git tag `agent-readiness-1945` pushed
