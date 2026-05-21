"""
test_logger.py — Tests for agent/logger.py

Run from the repo root:
    uv run python tests/test_logger.py

No pytest required. Exit code 0 = all passed, 1 = at least one failure.
"""

import os
import re
import sys
import shutil
import tempfile

# Resolve repo root (parent of tests/) and add to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from agent.logger import AgentLogger

PASS = "\033[92mPASS\033[0m"
FAIL = "\033[91mFAIL\033[0m"
failures = []

TIMESTAMP_RE = re.compile(r"\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}\]")


def check(label: str, condition: bool, detail: str = "") -> None:
    if condition:
        print(f"  {PASS}  {label}")
    else:
        msg = label + (f" — {detail}" if detail else "")
        print(f"  {FAIL}  {msg}")
        failures.append(msg)


def section(title: str) -> None:
    print(f"\n{title}")
    print("-" * len(title))


def read(path: str) -> str:
    with open(path, encoding="utf-8") as fh:
        return fh.read()


# ---------------------------------------------------------------------------
# Setup: fresh temp log dir per test run
# ---------------------------------------------------------------------------
tmp = tempfile.mkdtemp(prefix="logger_test_")
log_dir = os.path.join(tmp, "agent_logs")
log = AgentLogger(log_dir=log_dir)


# ---------------------------------------------------------------------------
# Initialisation
# ---------------------------------------------------------------------------
section("__init__ — all 7 files created")

expected_files = [
    "prompts.log",
    "decisions.log",
    "commands.log",
    "test_runs.log",
    "errors.log",
    "human_interventions.log",
    "final_report.md",
]
for fname in expected_files:
    fpath = os.path.join(log_dir, fname)
    check(f"{fname} exists after __init__", os.path.isfile(fpath))

# Calling __init__ again (re-instantiate) must not wipe existing content
log.log_prompt("seed prompt")
log2 = AgentLogger(log_dir=log_dir)
check(
    "re-instantiating does not truncate existing logs",
    "seed prompt" in read(os.path.join(log_dir, "prompts.log")),
)


# ---------------------------------------------------------------------------
# log_prompt
# ---------------------------------------------------------------------------
section("log_prompt")

log.log_prompt(
    prompt="Read the spec and make a plan.",
    context="Hidden task just released.",
    expected_action="Produce phased plan JSON.",
)
content = read(os.path.join(log_dir, "prompts.log"))

check("contains USER_PROMPT label", "USER_PROMPT" in content)
check("contains prompt text", "Read the spec and make a plan." in content)
check("contains context", "Hidden task just released." in content)
check("contains expected_action", "Produce phased plan JSON." in content)
check(
    "timestamp format correct",
    bool(TIMESTAMP_RE.search(content)),
    repr(content[:80]),
)

# Minimal call (no optional args)
log.log_prompt("minimal prompt")
check(
    "minimal prompt written without error",
    "minimal prompt" in read(os.path.join(log_dir, "prompts.log")),
)


# ---------------------------------------------------------------------------
# log_decision
# ---------------------------------------------------------------------------
section("log_decision")

log.log_decision(
    decision="Implement CLI entrypoint first.",
    reason="Tests cannot run without it.",
    evidence="Public test failures: all categories 0/250.",
    next_action="Create solution.py with argparse skeleton.",
)
content = read(os.path.join(log_dir, "decisions.log"))

check("contains DECISION label", "DECISION" in content)
check("contains decision text", "Implement CLI entrypoint first." in content)
check("contains reason", "Tests cannot run without it." in content)
check("contains evidence", "Public test failures" in content)
check("contains next_action", "Create solution.py" in content)
check("timestamp present", bool(TIMESTAMP_RE.search(content)))

# Minimal call
log.log_decision("minimal decision", "minimal reason")
check(
    "minimal decision written",
    "minimal decision" in read(os.path.join(log_dir, "decisions.log")),
)


# ---------------------------------------------------------------------------
# log_command
# ---------------------------------------------------------------------------
section("log_command")

log.log_command(
    command="python3 solution.py --help",
    exit_code=0,
    short_result="Help text printed correctly.",
    run_by="agent",
    working_dir="/workspace",
)
content = read(os.path.join(log_dir, "commands.log"))

check("contains COMMAND label", "COMMAND" in content)
check("contains command string", "python3 solution.py --help" in content)
check("contains exit code", "Exit code: 0" in content)
check("contains run_by", "Run by: agent" in content)
check("contains working_dir", "/workspace" in content)
check("contains short_result", "Help text printed correctly." in content)
check("timestamp present", bool(TIMESTAMP_RE.search(content)))

# Human-run command
log.log_command("pip install pytest", 0, "Installed pytest.", run_by="human")
check(
    "human run_by recorded",
    "Run by: human" in read(os.path.join(log_dir, "commands.log")),
)

# Non-zero exit
log.log_command("python3 solution.py bad_arg", 1, "Error: unrecognised arg.", run_by="agent")
check(
    "non-zero exit code recorded",
    "Exit code: 1" in read(os.path.join(log_dir, "commands.log")),
)


# ---------------------------------------------------------------------------
# log_test_run
# ---------------------------------------------------------------------------
section("log_test_run")

log.log_test_run(
    score=78,
    total=250,
    failing_categories=["output schema", "repeated rows"],
    next_step="Fix JSON output shape first.",
    suite="public",
    command='python3 run_tests.py --program "python3 solution.py"',
    run_by="agent",
)
content = read(os.path.join(log_dir, "test_runs.log"))

check("contains TEST_RUN label", "TEST_RUN" in content)
check("contains score", "78/250" in content)
check("contains failing categories", "output schema" in content)
check("contains next_step", "Fix JSON output shape first." in content)
check("contains suite", "Suite: public" in content)
check("contains command", "run_tests.py" in content)
check("timestamp present", bool(TIMESTAMP_RE.search(content)))

# No failing categories
log.log_test_run(score=250, total=250, failing_categories=[])
check(
    "zero failing categories writes 'none'",
    "none" in read(os.path.join(log_dir, "test_runs.log")),
)


# ---------------------------------------------------------------------------
# log_error
# ---------------------------------------------------------------------------
section("log_error")

log.log_error(
    error_type="MODEL_TIMEOUT",
    what="Local model timed out during spec summarisation.",
    impact="Agent loop stopped before plan was written.",
    action_taken="Restarted model server and reran the same prompt.",
    resolved=True,
)
content = read(os.path.join(log_dir, "errors.log"))

check("contains ERROR label", "ERROR" in content)
check("contains error type", "MODEL_TIMEOUT" in content)
check("contains what", "timed out" in content)
check("contains impact", "loop stopped" in content)
check("contains action_taken", "Restarted model server" in content)
check("resolved=True written as 'yes'", "Resolved: yes" in content)
check("timestamp present", bool(TIMESTAMP_RE.search(content)))

log.log_error("LOOP_STUCK", "Same patch applied 4 times.", "No progress.", "Forced analysis prompt.", resolved=False)
check(
    "resolved=False written as 'no'",
    "Resolved: no" in read(os.path.join(log_dir, "errors.log")),
)


# ---------------------------------------------------------------------------
# human_interventions.log — header only, never written programmatically
# ---------------------------------------------------------------------------
section("human_interventions.log")

hi_content = read(os.path.join(log_dir, "human_interventions.log"))
check("file has comment header", hi_content.startswith("#"))
check("header mentions human_interventions", "human_interventions" in hi_content)
check("no agent-written entries", "USER_PROMPT" not in hi_content)


# ---------------------------------------------------------------------------
# write_final_report
# ---------------------------------------------------------------------------
section("write_final_report")

log.write_final_report({
    "team_name": "Segfault Society",
    "members": "Alice, Bob, Carol",
    "repo": "https://github.com/example/team",
    "commit_hash": "abc1234",
    "public_score": 226,
    "public_total": 250,
    "run_command": "python3 solution.py compile input.txt",
    "primary_model": "qwen2.5-coder:7b",
    "provider": "Ollama",
    "score_progression": [
        ("2026-05-21 20:52", 31, 250),
        ("2026-05-21 22:06", 143, 250),
        ("2026-05-22 08:55", 226, 250),
    ],
    "human_interventions": ["Installed pytest (dependency missing)", "Restarted agent after timeout"],
    "what_worked": ["Phased planning", "Category-based fixing"],
    "what_failed": ["Full rewrites caused regressions"],
    "improvements": ["Better rollback detection", "Stricter patch size limits"],
    "notes": "No paid models used.",
})
report = read(os.path.join(log_dir, "final_report.md"))

check("report starts with # Final Report", report.startswith("# Final Report"))
check("contains team name", "Segfault Society" in report)
check("contains score", "226/250" in report)
check("contains model", "qwen2.5-coder:7b" in report)
check("contains score progression entry", "31/250" in report)
check("contains human intervention", "Installed pytest" in report)
check("contains what_worked item", "Phased planning" in report)
check("contains what_failed item", "regressions" in report)
check("contains improvements item", "rollback" in report)

# Minimal call — all optional keys absent
log2 = AgentLogger(log_dir=os.path.join(tmp, "minimal_logs"))
log2.write_final_report({})
minimal_report = read(os.path.join(tmp, "minimal_logs", "final_report.md"))
check("minimal report written without error", "# Final Report" in minimal_report)
check("missing keys show N/A", "N/A" in minimal_report)


# ---------------------------------------------------------------------------
# Multiple entries accumulate (append mode)
# ---------------------------------------------------------------------------
section("append behaviour")

log.log_prompt("first")
log.log_prompt("second")
log.log_prompt("third")
all_prompts = read(os.path.join(log_dir, "prompts.log"))
check("multiple prompts all present", all_prompts.count("USER_PROMPT") >= 3)


# ---------------------------------------------------------------------------
# Teardown + summary
# ---------------------------------------------------------------------------
shutil.rmtree(tmp)

print()
if failures:
    print(f"FAILED — {len(failures)} test(s) failed:")
    for f in failures:
        print(f"  • {f}")
    sys.exit(1)
else:
    print("All tests passed.")
    sys.exit(0)
