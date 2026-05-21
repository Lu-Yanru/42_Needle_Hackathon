"""
Main agent loop.

Usage:
    python3 agent/run_agent.py --spec <path/to/SPEC.md> [--workspace ./solution] [--dry-run]

Action JSON schema (the contract with A's llm.py and C's tools.py):
    {
        "action":    "write_file" | "run_command" | "read_file" | "stop",
        "path":      str,   # required for write_file / read_file
        "content":   str,   # required for write_file
        "command":   str,   # required for run_command
        "reasoning": str    # always required, one sentence
    }

State machine:
    PLANNING -> IMPLEMENTING -> TESTING -> FIXING -> TESTING -> ... -> DONE
                                              ^                |
                                              +----------------+
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

# These imports are stubs right now — A owns llm, C owns tools + logger.
# Keeping the imports up here surfaces the API contract at the 15:00 sync.
from agent import llm, tools, prompts
from agent.logger import AgentLogger


MAX_ITERATIONS = 40
WORKSPACE_DEFAULT = "./solution"

# Valid state machine states
STATES = ("PLANNING", "IMPLEMENTING", "TESTING", "FIXING", "DONE")


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser()
    p.add_argument("--spec", required=True, help="Path to the spec markdown file")
    p.add_argument(
        "--workspace", default=WORKSPACE_DEFAULT, help="Where the agent writes code"
    )
    p.add_argument(
        "--dry-run", action="store_true", help="One model call, no side effects"
    )
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
        "files": {},  # path -> last known content
        "last_test_result": None,  # {score, total, failing_categories, raw}
        "best_score": -1,
        "no_improvement_streak": 0,
        "iteration": 0,
        "recent_attempts": [],  # last N decisions, for stuck-analysis
    }


def build_prompt(state: dict) -> str:
    """Pick the right prompt template for the current phase."""
    if state["phase"] == "PLANNING":
        return prompts.PLANNING_PROMPT.format(spec=state["spec"])

    if state["phase"] in ("IMPLEMENTING", "TESTING"):
        return prompts.IMPLEMENTING_PROMPT.format(
            plan=json.dumps(state["plan"], indent=2),
            files=_render_files(state["files"]),
            last_test_result=json.dumps(state["last_test_result"], indent=2)
            if state["last_test_result"]
            else "none yet",
        )

    if state["phase"] == "FIXING":
        if state["no_improvement_streak"] >= 3:
            return prompts.STUCK_ANALYSIS_PROMPT.format(
                plan=json.dumps(state["plan"], indent=2),
                files=_render_files(state["files"]),
                failing_category=(
                    state["last_test_result"]["failing_categories"] or ["unknown"]
                )[0],
                recent_attempts="\n---\n".join(state["recent_attempts"][-3:]),
            )
        return prompts.FIXING_PROMPT.format(
            plan=json.dumps(state["plan"], indent=2),
            files=_render_files(state["files"]),
            score=state["last_test_result"]["score"],
            total=state["last_test_result"]["total"],
            failing_categories=state["last_test_result"]["failing_categories"],
            failure_samples=state["last_test_result"].get("raw", "")[:2000],
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
            result=f"{len(decision['content'])} bytes",
        )

    elif action == "run_command":
        result = tools.run_command(decision["command"], cwd=state["workspace"])
        logger.log_command(
            decision["command"],
            exit_code=result["exit_code"],
            result=result["stdout"][:500],
        )
        # TODO(A): if this is the test command, parse it via test_runner.run_public_tests
        state["last_test_result"] = result  # placeholder shape

    elif action == "read_file":
        path = decision["path"]
        content = tools.read_file(_in_workspace(state, path))
        state["files"][path] = content
        logger.log_command(
            f"read_file {path}", exit_code=0, result=f"{len(content)} bytes"
        )

    elif action == "stop":
        state["phase"] = "DONE"
        logger.log_decision(decision, reason="agent requested stop", next_action="exit")

    else:
        logger.log_error(
            "bad_action",
            what=str(decision),
            impact="iteration wasted",
            action_taken="continue",
        )


def _in_workspace(state: dict, path: str) -> str:
    return str(Path(state["workspace"]) / path)


def advance_phase(state: dict, decision: dict) -> None:
    """Move through the state machine based on what just happened."""
    if state["phase"] == "PLANNING":
        # Decision should be the plan JSON, not an action.
        # (Special-cased in main_loop — see TODO.)
        state["phase"] = "IMPLEMENTING"

    elif state["phase"] == "IMPLEMENTING":
        if decision.get("action") == "run_command":
            state["phase"] = "TESTING"

    elif state["phase"] == "TESTING":
        tr = state["last_test_result"]
        if tr and tr.get("score") == tr.get("total"):
            state["phase"] = "DONE"
        elif tr and tr.get("score", 0) > state["best_score"]:
            state["best_score"] = tr["score"]
            state["no_improvement_streak"] = 0
            state["phase"] = "FIXING"
        else:
            state["no_improvement_streak"] += 1
            state["phase"] = "FIXING"

    elif state["phase"] == "FIXING":
        state["phase"] = "TESTING"  # next iter will run tests again


def main_loop(args: argparse.Namespace) -> int:
    logger = AgentLogger()
    state = build_initial_state(args.spec, args.workspace)
    Path(state["workspace"]).mkdir(parents=True, exist_ok=True)

    while state["iteration"] < args.max_iter and state["phase"] != "DONE":
        prompt = build_prompt(state)
        logger.log_prompt(prompt)

        # PLANNING is special: response is the plan, not a tool action.
        if state["phase"] == "PLANNING":
            raw = llm.call_model_json(prompt, schema_hint="plan")
            state["plan"] = raw
            Path("agent_logs/plan.json").write_text(json.dumps(raw, indent=2))
            advance_phase(state, decision={})
        else:
            decision = llm.call_model_json(prompt, schema_hint="action")
            logger.log_decision(
                decision,
                reason=decision.get("reasoning", ""),
                next_action=decision.get("action"),
            )
            state["recent_attempts"].append(json.dumps(decision)[:500])
            dispatch(decision, state, logger)
            advance_phase(state, decision)

        state["iteration"] += 1

        if args.dry_run:
            print("[dry-run] one iteration complete, exiting")
            break

    logger.write_final_report(
        {
            "iterations": state["iteration"],
            "final_phase": state["phase"],
            "best_score": state["best_score"],
            "last_test_result": state["last_test_result"],
        }
    )
    return 0 if state["phase"] == "DONE" else 1


if __name__ == "__main__":
    sys.exit(main_loop(parse_args()))
