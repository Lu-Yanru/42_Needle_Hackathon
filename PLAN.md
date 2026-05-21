# Hackathon Agent Implementation Plan

**Constraint**: Local/free models only after 20:00. Ollama recommended.\
**Deadline**: 19:45 checkpoint → 20:00 reveal → Friday 12:00 submission\
**Success criteria**: Agent can read spec → write code → run tests → fix failures → log everything, autonomously.

______________________________________________________________________

## Phase 0: Environment Setup (30 min)

**Goal**: Working Ollama + Python env, verified before anything else.

### Steps

1. Install Ollama if not present: `curl -fsSL https://ollama.com/install.sh | sh`
1. Pull a capable coding model: `ollama pull qwen2.5-coder:7b` (fallback: `deepseek-coder:6.7b`)
1. Verify model responds: `ollama run qwen2.5-coder:7b "print hello world in python"`
1. Create project directory: `mkdir -p ~/hackathon-agent && cd ~/hackathon-agent`
1. Create Python venv: `python3 -m venv .venv && source .venv/bin/activate`
1. Install minimal deps: `pip install requests`

### Test

- `ollama list` shows the model
- `python3 -c "import requests; print('ok')"` passes
- A quick curl to `http://localhost:11434/api/generate` returns a response

______________________________________________________________________

## Phase 1: Core Agent Loop (60 min)

**Goal**: A single Python script `agent/run_agent.py` that can call the model, read files, write files, and run shell commands.

### Files to create

```
agent/
  run_agent.py       # main loop
  tools.py           # file read/write/run_command helpers
  llm.py             # Ollama API wrapper
  prompts.py         # prompt templates
```

### `llm.py` — Ollama wrapper

```python
def call_model(prompt: str, system: str = "") -> str:
    # POST to http://localhost:11434/api/generate
    # model: qwen2.5-coder:7b
    # return response text
```

### `tools.py` — Tool helpers

```python
def read_file(path: str) -> str
def write_file(path: str, content: str) -> None
def run_command(cmd: str, cwd: str = ".") -> dict:  # {stdout, stderr, exit_code}
def list_dir(path: str) -> list
```

### `run_agent.py` — Main loop

```python
state = {
    "spec": "",
    "last_test_result": None,
    "iteration": 0,
    "workspace": "./workspace"
}

while iteration < MAX_ITER:
    # 1. Build prompt with current state
    # 2. Call model → get JSON action: {action, path, content, command}
    # 3. Dispatch action via tools
    # 4. Log everything
    # 5. If action == "stop" or score == 100%: break
```

### Model output format (strict JSON)

Agent is prompted to respond ONLY with:

```json
{
  "action": "write_file|run_command|read_file|stop",
  "path": "...",
  "content": "...",
  "command": "...",
  "reasoning": "one sentence"
}
```

### Test

- Run `python3 agent/run_agent.py --dry-run` → prints one model call and one action without side effects
- Manually verify file write and command run work

______________________________________________________________________

## Phase 2: Logging System (30 min)

**Goal**: All 7 required log files written automatically during the loop.

### Files

```
agent_logs/
  prompts.log
  decisions.log
  commands.log
  test_runs.log
  errors.log
  human_interventions.log   # manually filled
  final_report.md           # written at end of run
```

### `logger.py`

```python
class AgentLogger:
    def log_prompt(self, prompt)
    def log_decision(self, decision, reason, next_action)
    def log_command(self, cmd, exit_code, result, run_by="agent")
    def log_test_run(self, score, failing_categories, next_step)
    def log_error(self, error_type, what, impact, action_taken)
    def write_final_report(self, summary_dict)
```

All methods prepend `[YYYY-MM-DD HH:MM]` timestamps.

### Test

- Run agent on a dummy task for 2 iterations → verify all log files exist and have timestamps

______________________________________________________________________

## Phase 3: Spec Reader + Planner (45 min)

**Goal**: Agent reads `SECRET_SPEC.md` and produces a structured plan before writing any code.

### Prompt: Phase 1 — Planning

```
You are a coding agent. Read this specification carefully.
Your ONLY task right now is to produce an implementation plan.
Do NOT write any code yet.

Output JSON:
{
  "plan": ["step1", "step2", ...],
  "entrypoint": "solution.py",
  "run_command": "python3 solution.py ...",
  "required_inputs": "...",
  "required_outputs": "...",
  "edge_cases": ["..."]
}
```

### State machine

```
PLANNING → IMPLEMENTING → TESTING → FIXING → TESTING → ... → DONE
```

The agent only moves to IMPLEMENTING after the plan JSON is parsed and saved.

### Test

- Point agent at a sample Markdown spec (write a toy one: "build a CLI that reverses a string")
- Verify it outputs a valid plan JSON without writing any files

______________________________________________________________________

## Phase 4: Code Generation + Test Runner (60 min)

**Goal**: Agent generates code, runs public tests, parses results.

### Prompt: Phase 2 — Implementation

```
Current plan: {plan}
Current file contents: {files}
Last test result: {test_result}

Write or edit ONE file to make progress on the plan.
Output JSON: { "action": "write_file", "path": "...", "content": "..." }
```

### Test runner integration

```python
def run_public_tests(workspace: str, program_cmd: str) -> dict:
    cmd = f"python3 secret_spec/test_runner/run_tests.py --program '{program_cmd}' --suite public"
    result = run_command(cmd, cwd=workspace)
    return parse_test_output(result["stdout"])  # → {score, total, failing_categories}
```

### Test

- Use toy spec + toy test suite (write 3 simple tests manually)
- Agent generates code → tests run → score returned

______________________________________________________________________

## Phase 5: Failure Analysis + Targeted Fix Loop (45 min)

**Goal**: Agent reads failing test output and makes targeted patches (not full rewrites).

### Prompt: Phase 3 — Fixing

```
Test result: {score}/{total}
Failing categories: {categories}
Failing test examples:
{failure_samples}

RULES:
- Fix ONE failing category at a time
- Do NOT rewrite the whole file
- Do NOT add debug prints to stdout
- After fix, I will rerun tests

Output JSON: { "action": "write_file", "path": "...", "content": "..." }
```

### Anti-thrash guard

```python
if consecutive_no_improvement >= 3:
    # Force prompt: "Summarize WHY this category keeps failing, then try a different approach"
    force_analysis_prompt()
```

### Rollback

```python
# Before every write, snapshot current file
snapshots[path] = current_content

# If score drops after patch:
if new_score < prev_score:
    restore_snapshot(path)
    log_decision("Rolled back patch — score regression")
```

### Test

- Intentionally break toy solution → agent should detect regression and rollback

______________________________________________________________________

## Phase 6: Self-Test Generation (30 min)

**Goal**: Agent generates additional tests from the spec to catch edge cases.

### Prompt: Self-test generation

```
Based on this specification section: {spec_section}
Generate 5 additional test cases as Python assertions.
Focus on: edge cases, boundary values, error handling.
Output only valid Python test code.
```

### Integration

```python
def run_self_tests(workspace: str) -> dict:
    result = run_command("python3 agent_tests/self_generated_tests.py", cwd=workspace)
    return parse_self_test_output(result)
```

### Test

- Run self-test generation on toy spec → verify output is valid Python → run it

______________________________________________________________________

## Phase 7: agent_manifest.json + Final Report (20 min)

**Goal**: Submission artifacts generated automatically at end of run.

### `generate_submission.py`

```python
def write_manifest():
    # Writes agent_manifest.json with model name, provider, paid=false fields

def write_final_report(score_progression, interventions, failures):
    # Fills final_report.md template
```

### Test

- Run `python3 generate_submission.py` → verify both files created and valid JSON

______________________________________________________________________

## Phase 8: Dry Run on Toy Task (30 min)

**Goal**: Full end-to-end test before 19:45 checkpoint.

### Toy spec

Write `toy_spec/SPEC.md`:

```
Build a CLI tool: python3 solution.py <input_file>
- Reads a text file line by line
- Outputs JSON: {"lines": [...], "count": N}
- Exit 0 on success, exit 1 if file not found
```

Write 5 toy tests. Run the full agent loop. Verify:

- [ ] Plan generated
- [ ] Code written
- [ ] Tests run
- [ ] At least one failure fixed
- [ ] Logs written with timestamps
- [ ] Manifest generated

______________________________________________________________________

## Phase 9: Checkpoint at 19:45

```bash
git add -A
git commit -m "Agent readiness checkpoint"
git tag agent-readiness-1945
git push --follow-tags
```

______________________________________________________________________

## Phase 10: Real Run (20:00 onward)

1. Copy `secret_spec/SECRET_SPEC.md` into agent workspace
1. Run: `python3 agent/run_agent.py --spec secret_spec/SECRET_SPEC.md --workspace ./solution`
1. Monitor logs in separate terminal: `tail -f agent_logs/test_runs.log`
1. Let it run. Intervene only if:
   - Agent crashes → restart, log intervention
   - Agent stuck in loop >3 iterations → edit prompt, log intervention
   - Missing dependency → install, log intervention
1. Log ALL interventions in `human_interventions.log`

______________________________________________________________________

## File Structure (final)

```
hackathon-agent/
  agent/
    run_agent.py
    llm.py
    tools.py
    prompts.py
    logger.py
    generate_submission.py
  agent_logs/
    prompts.log
    decisions.log
    commands.log
    test_runs.log
    errors.log
    human_interventions.log
    final_report.md
  solution/              # workspace for the hidden task
  toy_spec/              # for pre-reveal testing
  agent_manifest.json
  README.md
  requirements.txt
```

______________________________________________________________________

## Risk Mitigations

| Risk | Mitigation |
|---|---|
| Model too slow / times out | Set timeout=120s, retry 2x, fallback to smaller model |
| Model outputs non-JSON | Retry with "You MUST respond with only valid JSON. No prose." |
| Score regression after patch | Snapshot + rollback before every write |
| Agent stuck in loop | After 3 same-score iterations, force analysis prompt |
| Missing dependencies at 20:00 | Pre-install pytest, common stdlib-only approach for solution |
| Model misunderstands spec | Phase 1 is PLAN ONLY — verify plan JSON before coding starts |

______________________________________________________________________

## Time Budget

| Phase | Time | Cumulative |
|---|---|---|
| 0: Env setup | 30 min | 0:30 |
| 1: Core loop | 60 min | 1:30 |
| 2: Logging | 30 min | 2:00 |
| 3: Spec reader | 45 min | 2:45 |
| 4: Code gen + test runner | 60 min | 3:45 |
| 5: Fix loop + rollback | 45 min | 4:30 |
| 6: Self-tests | 30 min | 5:00 |
| 7: Manifest + report | 20 min | 5:20 |
| 8: Dry run | 30 min | 5:50 |
| 9: Checkpoint | 10 min | 6:00 |
| Buffer / debugging | 2:00 | 8:00 |

______________________________________________________________________

## Definition of Done (19:45 checkpoint)

- [ ] `python3 agent/run_agent.py --spec <path>` starts without errors
- [ ] Agent calls Ollama, gets a response
- [ ] Agent writes at least one file
- [ ] Agent runs at least one command
- [ ] Agent parses test output (even from toy tests)
- [ ] All 7 log files created with timestamps
- [ ] Toy task end-to-end: score improves over 3+ iterations
- [ ] `agent_manifest.json` generated correctly
- [ ] Git checkpoint tagged `agent-readiness-1945`
