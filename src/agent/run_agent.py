"""
Main agent loop.

Usage:
    uv run python -m agent.run_agent --spec <path/to/SPEC.md> [--workspace ./solution] [--dry-run]

Action JSON schema (the contract with A's llm.py and C's tools.py):
    {
        "action":    "write_file" | "run_command" | "run_tests" | "read_file" | "stop",
        "path":      str,   # required for write_file / read_file
        "content":   str,   # required for write_file
        "command":   str,   # required for run_command (NOT for run_tests)
        "reasoning": str    # always required, one sentence
    }

State machine:
    PLANNING -> IMPLEMENTING -> TESTING -> FIXING -> TESTING -> ... -> DONE
                                              ^                |
                                              +----------------+

    PLANNING / IMPLEMENTING / FIXING are model-driven (we prompt the model).
    TESTING is deterministic — the loop itself runs the public test runner,
    parses results, and decides whether to move to DONE or FIXING. No model
    call is made in TESTING; this prevents the model from reacting to stale
    results between a fix and the next test run.
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime
from pathlib import Path

from agent import llm, prompts, tools, test_runner
from agent.logger import AgentLogger


MAX_ITERATIONS = 40
WORKSPACE_DEFAULT = "./solution"
MAX_CONSECUTIVE_LLM_ERRORS = 3

STATES = ("PLANNING", "IMPLEMENTING", "TESTING", "FIXING", "DONE")


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser()
    p.add_argument("--spec", required=True, help="Path to the spec markdown file")
    p.add_argument("--workspace", default=WORKSPACE_DEFAULT, help="Where the agent writes code")
    p.add_argument("--dry-run", action="store_true", help="One model call, no side effects")
    p.add_argument("--max-iter", type=int, default=MAX_ITERATIONS)
    return p.parse_args()


def build_initial_state(spec_path: str, workspace: str) -> dict:
    spec_text = Path(spec_path).read_text()
    return {
        "spec": spec_text,
        "spec_path": spec_path,
        "workspace": workspace,
        "phase": "PLANNING",
        "plan": None,
        "files": {},               # path -> last known content
        "last_test_result": None,  # {score, total, failing_categories, raw}
        "best_score": -1,
        "no_improvement_streak": 0,
        "consecutive_llm_errors": 0,
        "iteration": 0,
        "recent_attempts": [],     # last N decisions, for stuck-analysis
        "score_progression": [],   # list of (ts, score, total)
    }


def build_prompt(state: dict) -> str:
    """Pick the right prompt template for the current phase."""
    if state["phase"] == "PLANNING":
        return prompts.PLANNING_PROMPT.format(spec=state["spec"])

    if state["phase"] == "IMPLEMENTING":
        return prompts.IMPLEMENTING_PROMPT.format(
            plan=json.dumps(state["plan"], indent=2),
            files=_render_files(state["files"]),
            last_test_result=json.dumps(state["last_test_result"], indent=2) if state["last_test_result"] else "none yet",
        )

    if state["phase"] == "FIXING":
        tr = state["last_test_result"] or {}
        if state["no_improvement_streak"] >= 3:
            return prompts.STUCK_ANALYSIS_PROMPT.format(
                plan=json.dumps(state["plan"], indent=2),
                files=_render_files(state["files"]),
                failing_category=(tr.get("failing_categories") or ["unknown"])[0],
                recent_attempts="\n---\n".join(state["recent_attempts"][-3:]),
            )
        return prompts.FIXING_PROMPT.format(
            plan=json.dumps(state["plan"], indent=2),
            files=_render_files(state["files"]),
            score=tr.get("score", 0),
            total=tr.get("total", 0),
            failing_categories=tr.get("failing_categories", []),
            failure_samples=(tr.get("raw") or "")[:2000],
        )

    raise ValueError(f"No prompt for phase {state['phase']}")


def _render_files(files: dict) -> str:
    if not files:
        return "(workspace is empty)"
    parts = []
    for path, content in files.items():
        parts.append(f"### {path}\n```\n{content}\n```")
    return "\n\n".join(parts)


def dispatch(decision: dict, state: dict, logger: AgentLogger) -> None:
    """Execute a model decision against tools / state."""
    action = decision.get("action")

    if action == "write_file":
        path = decision["path"]
        # TODO(C): tools.snapshot(path) here before overwriting
        tools.write_file(_in_workspace(state, path), decision["content"])
        state["files"][path] = decision["content"]
        logger.log_command(
            f"write_file {path}",
            exit_code=0,
            short_result=f"{len(decision['content'])} bytes",
        )

    elif action == "run_command":
        result = tools.run_command(decision["command"], cwd=state["workspace"])
        logger.log_command(
            decision["command"],
            exit_code=result["exit_code"],
            short_result=(result["stdout"] or "")[:500],
            working_dir=state["workspace"],
        )
        # Not a test run — we don't update last_test_result here.

    elif action == "run_tests":
        _run_tests_and_log(state, logger)

    elif action == "read_file":
        path = decision["path"]
        content = tools.read_file(_in_workspace(state, path))
        state["files"][path] = content
        logger.log_command(
            f"read_file {path}",
            exit_code=0,
            short_result=f"{len(content)} bytes",
        )

    elif action == "stop":
        state["phase"] = "DONE"
        logger.log_decision(
            decision="stop",
            reason=decision.get("reasoning", "agent requested stop"),
            evidence=json.dumps(decision)[:500],
            next_action="exit",
        )

    else:
        logger.log_error(
            error_type="BAD_ACTION",
            what=f"unknown or missing action in decision: {json.dumps(decision)[:300]}",
            impact="iteration wasted",
            action_taken="continue to next iteration",
        )


def _in_workspace(state: dict, path: str) -> str:
    return str(Path(state["workspace"]) / path)


def _run_tests_and_log(state: dict, logger: AgentLogger) -> None:
    """Run the public test runner, populate state, and log results."""
    run_cmd = (state.get("plan") or {}).get("run_command", "")
    if not run_cmd:
        logger.log_error(
            error_type="NO_RUN_COMMAND",
            what="plan does not specify run_command",
            impact="cannot invoke test runner",
            action_taken="skipped test run; loop will continue",
        )
        state["last_test_result"] = {
            "score": 0,
            "total": 0,
            "failing_categories": [],
            "raw": "",
            "error": "no run_command in plan",
        }
        return

    result = test_runner.run_public_tests(state["workspace"], run_cmd)
    state["last_test_result"] = result

    if result.get("error") and result.get("total", 0) == 0:
        logger.log_error(
            error_type="TEST_RUNNER_ERROR",
            what=result["error"],
            impact="no usable score this iteration",
            action_taken="loop will continue; agent prompted with empty result",
        )
        return

    logger.log_test_run(
        score=result["score"],
        total=result["total"],
        failing_categories=result["failing_categories"],
        command=run_cmd,
    )
    state["score_progression"].append(
        (datetime.now().strftime("%Y-%m-%d %H:%M"), result["score"], result["total"])
    )


def advance_phase_after_model(state: dict, decision: dict) -> None:
    """Move through model-driven phases after a model decision was dispatched."""
    action = decision.get("action")

    if state["phase"] == "IMPLEMENTING":
        if action == "run_tests":
            state["phase"] = "TESTING"

    elif state["phase"] == "FIXING":
        if action == "write_file":
            state["phase"] = "TESTING"  # next loop iter will run tests


def _transition_from_testing(state: dict) -> None:
    """Decide whether to stop or keep fixing, based on the just-run test result."""
    tr = state["last_test_result"] or {}
    total = tr.get("total") or 0
    score = tr.get("score") or 0

    if total > 0 and score == total:
        state["phase"] = "DONE"
        return

    if score > state["best_score"]:
        state["best_score"] = score
        state["no_improvement_streak"] = 0
    else:
        state["no_improvement_streak"] += 1

    state["phase"] = "FIXING"


def _build_final_summary(state: dict) -> dict:
    """Construct the summary dict consumed by AgentLogger.write_final_report.

    Fills what the loop knows. Submission script (Phase 7) is expected to
    overwrite team / commit / model fields later.
    """
    tr = state["last_test_result"] or {}
    return {
        "public_score": tr.get("score"),
        "public_total": tr.get("total"),
        "run_command": (state.get("plan") or {}).get("run_command"),
        "score_progression": state["score_progression"],
        "notes": (
            f"iterations={state['iteration']}, "
            f"final_phase={state['phase']}, "
            f"best_score={state['best_score']}, "
            f"no_improvement_streak={state['no_improvement_streak']}"
        ),
    }


def main_loop(args: argparse.Namespace) -> int:
    logger = AgentLogger()
    state = build_initial_state(args.spec, args.workspace)
    Path(state["workspace"]).mkdir(parents=True, exist_ok=True)

    while state["iteration"] < args.max_iter and state["phase"] != "DONE":
        # TESTING is deterministic — the loop runs tests, no model call.
        if state["phase"] == "TESTING":
            _run_tests_and_log(state, logger)
            _transition_from_testing(state)
            state["iteration"] += 1
            if args.dry_run:
                print("[dry-run] one iteration complete, exiting")
                break
            continue

        # Model-driven phases (PLANNING / IMPLEMENTING / FIXING)
        try:
            prompt = build_prompt(state)
            logger.log_prompt(prompt, context=f"phase={state['phase']}")

            if state["phase"] == "PLANNING":
                plan = llm.call_model_json(prompt, schema_hint="plan")
                state["plan"] = plan
                Path("agent_logs/plan.json").write_text(json.dumps(plan, indent=2))
                logger.log_decision(
                    decision="plan accepted",
                    reason=f"PLANNING produced run_command={plan.get('run_command', '?')}",
                    evidence=json.dumps(plan)[:500],
                    next_action="IMPLEMENTING",
                )
                state["phase"] = "IMPLEMENTING"
            else:
                decision = llm.call_model_json(prompt, schema_hint="action")
                logger.log_decision(
                    decision=str(decision.get("action", "?")),
                    reason=decision.get("reasoning", "(no reasoning provided)"),
                    evidence=json.dumps(decision)[:500],
                    next_action=decision.get("action"),
                )
                state["recent_attempts"].append(json.dumps(decision)[:500])
                dispatch(decision, state, logger)
                advance_phase_after_model(state, decision)

            state["consecutive_llm_errors"] = 0

        except (RuntimeError, ValueError) as e:
            # llm.call_model raises RuntimeError on total failure,
            # llm.call_model_json raises ValueError after 3 JSON parse failures.
            logger.log_error(
                error_type=type(e).__name__,
                what=str(e)[:500],
                impact="iteration produced no usable model output",
                action_taken="continue; abort after 3 consecutive failures",
            )
            state["consecutive_llm_errors"] += 1
            if state["consecutive_llm_errors"] >= MAX_CONSECUTIVE_LLM_ERRORS:
                logger.log_error(
                    error_type="LLM_PERSISTENT_FAILURE",
                    what=f"{MAX_CONSECUTIVE_LLM_ERRORS} consecutive llm errors",
                    impact="aborting run",
                    action_taken="exit loop",
                )
                break

        state["iteration"] += 1

        if args.dry_run:
            print("[dry-run] one iteration complete, exiting")
            break

    logger.write_final_report(_build_final_summary(state))
    return 0 if state["phase"] == "DONE" else 1


if __name__ == "__main__":
    sys.exit(main_loop(parse_args()))
