"""
logger.py — Structured logging for the agent loop.

Creates and appends to all 7 required log files under agent_logs/:
  prompts.log
  decisions.log
  commands.log
  test_runs.log
  errors.log
  human_interventions.log   (header only — filled manually)
  final_report.md           (written once at end of run)

Usage:
    from agent.logger import AgentLogger
    log = AgentLogger()                        # defaults to agent_logs/
    log = AgentLogger(log_dir="my_logs/")      # custom directory

All methods append with [YYYY-MM-DD HH:MM] timestamps.
"""

import os
from datetime import datetime


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _ts() -> str:
    """Return current timestamp in [YYYY-MM-DD HH:MM] format."""
    return datetime.now().strftime("[%Y-%m-%d %H:%M]")


def _append(path: str, text: str) -> None:
    """Append text + trailing newline to a file."""
    with open(path, "a", encoding="utf-8") as fh:
        fh.write(text + "\n")


# ---------------------------------------------------------------------------
# AgentLogger
# ---------------------------------------------------------------------------

class AgentLogger:
    """Writes structured, timestamped entries to all required log files."""

    # Map of attribute name → filename
    _LOG_FILES = {
        "prompts":       "prompts.log",
        "decisions":     "decisions.log",
        "commands":      "commands.log",
        "test_runs":     "test_runs.log",
        "errors":        "errors.log",
        "interventions": "human_interventions.log",
    }

    def __init__(self, log_dir: str = "agent_logs") -> None:
        self.log_dir = os.path.abspath(log_dir)
        os.makedirs(self.log_dir, exist_ok=True)

        # Build absolute paths for every log file
        for attr, filename in self._LOG_FILES.items():
            setattr(self, f"_{attr}_path", os.path.join(self.log_dir, filename))

        self._report_path = os.path.join(self.log_dir, "final_report.md")

        # Ensure all 7 files exist (judges require all 7)
        self._init_files()

    # ------------------------------------------------------------------
    # Initialisation
    # ------------------------------------------------------------------

    def _init_files(self) -> None:
        """Create log files if they don't exist yet."""
        for attr, filename in self._LOG_FILES.items():
            path = getattr(self, f"_{attr}_path")
            if not os.path.exists(path):
                header = self._file_header(filename)
                with open(path, "w", encoding="utf-8") as fh:
                    fh.write(header)

        if not os.path.exists(self._report_path):
            with open(self._report_path, "w", encoding="utf-8") as fh:
                fh.write("# Final Report\n\n*Not yet written. Run generate_submission.py or call write_final_report().*\n")

    @staticmethod
    def _file_header(filename: str) -> str:
        """Return a one-line comment header for a log file."""
        headers = {
            "prompts.log":              "# prompts.log — Human prompts sent to the agent\n\n",
            "decisions.log":            "# decisions.log — Important agent decisions\n\n",
            "commands.log":             "# commands.log — Commands run by agent or humans\n\n",
            "test_runs.log":            "# test_runs.log — Public/self-test runs and score progression\n\n",
            "errors.log":               "# errors.log — Crashes, tool failures, and stuck loops\n\n",
            "human_interventions.log":  (
                "# human_interventions.log — Manual actions after hidden task release\n"
                "# Fill this in by hand. Format:\n"
                "#\n"
                "# [YYYY-MM-DD HH:MM] TYPE\n"
                "# What happened:\n"
                "# Why:\n"
                "# Files or settings affected:\n"
                "# Touched final task code directly: yes/no\n"
                "# Notes:\n\n"
            ),
        }
        return headers.get(filename, f"# {filename}\n\n")

    # ------------------------------------------------------------------
    # Public logging methods
    # ------------------------------------------------------------------

    def log_prompt(
        self,
        prompt: str,
        context: str = "",
        expected_action: str = "",
    ) -> None:
        """Log a human prompt sent to the agent.

        Args:
            prompt:          The prompt text.
            context:         Why this prompt was sent (optional).
            expected_action: What the agent should do next (optional).
        """
        lines = [f"{_ts()} USER_PROMPT"]
        lines.append(f"Prompt: {prompt}")
        if context:
            lines.append(f"Context: {context}")
        if expected_action:
            lines.append(f"Expected agent action: {expected_action}")
        _append(self._prompts_path, "\n".join(lines) + "\n")

    def log_decision(
        self,
        decision: str,
        reason: str,
        evidence: str = "",
        next_action: str = "",
    ) -> None:
        """Log an important agent decision.

        Args:
            decision:    What the agent decided.
            reason:      Why it decided this.
            evidence:    Inputs or observations that drove the decision (optional).
            next_action: What the agent will do next (optional).
        """
        lines = [f"{_ts()} DECISION"]
        lines.append(f"Decision: {decision}")
        lines.append(f"Reason: {reason}")
        if evidence:
            lines.append(f"Evidence/input used: {evidence}")
        if next_action:
            lines.append(f"Next action: {next_action}")
        _append(self._decisions_path, "\n".join(lines) + "\n")

    def log_command(
        self,
        command: str,
        exit_code: int,
        short_result: str,
        run_by: str = "agent",
        working_dir: str = "",
    ) -> None:
        """Log a shell command that was run.

        Args:
            command:      The command string.
            exit_code:    Exit code returned.
            short_result: One-line summary of what happened.
            run_by:       "agent" or "human" (default "agent").
            working_dir:  CWD used (optional).
        """
        lines = [f"{_ts()} COMMAND"]
        lines.append(f"Run by: {run_by}")
        lines.append(f"Command: {command}")
        if working_dir:
            lines.append(f"Working directory: {working_dir}")
        lines.append(f"Exit code: {exit_code}")
        lines.append(f"Short result: {short_result}")
        _append(self._commands_path, "\n".join(lines) + "\n")

    def log_test_run(
        self,
        score: int,
        total: int,
        failing_categories: list[str],
        next_step: str = "",
        suite: str = "public",
        command: str = "",
        run_by: str = "agent",
    ) -> None:
        """Log a public or self-generated test run.

        Args:
            score:               Number of tests passed.
            total:               Total number of tests.
            failing_categories:  List of category names that are failing.
            next_step:           What the agent plans to do next (optional).
            suite:               "public", "self-generated", or "manual smoke".
            command:             The test command used (optional).
            run_by:              "agent" or "human".
        """
        lines = [f"{_ts()} TEST_RUN"]
        lines.append(f"Run by: {run_by}")
        if command:
            lines.append(f"Command: {command}")
        lines.append(f"Suite: {suite}")
        lines.append(f"Score/result: {score}/{total}")
        cats = ", ".join(failing_categories) if failing_categories else "none"
        lines.append(f"Main failing categories: {cats}")
        if next_step:
            lines.append(f"Agent response/next step: {next_step}")
        _append(self._test_runs_path, "\n".join(lines) + "\n")

    def log_error(
        self,
        error_type: str,
        what: str,
        impact: str,
        action_taken: str,
        resolved: bool = False,
    ) -> None:
        """Log an operational error (crash, stuck loop, tool failure).

        Args:
            error_type:   Short type label e.g. MODEL_TIMEOUT, LOOP_STUCK.
            what:         What happened.
            impact:       What it blocked or broke.
            action_taken: How it was addressed.
            resolved:     Whether the issue is now resolved.
        """
        lines = [f"{_ts()} ERROR"]
        lines.append(f"Type: {error_type}")
        lines.append(f"What happened: {what}")
        lines.append(f"Impact: {impact}")
        lines.append(f"Action taken: {action_taken}")
        lines.append(f"Resolved: {'yes' if resolved else 'no'}")
        _append(self._errors_path, "\n".join(lines) + "\n")

    # ------------------------------------------------------------------
    # Final report
    # ------------------------------------------------------------------

    def write_final_report(self, summary: dict) -> None:
        """Write final_report.md from a summary dict.

        Expected keys (all optional — missing keys are shown as 'N/A'):
            team_name, members, repo, commit_hash,
            public_score, public_total,
            primary_model, provider,
            score_progression,   # list of (timestamp, score, total) tuples
            human_interventions, # list of strings
            what_worked,         # list of strings
            what_failed,         # list of strings
            improvements,        # list of strings
            notes
        """
        def get(key: str, default: str = "N/A") -> str:
            val = summary.get(key, default)
            return str(val) if val else default

        def bullet_list(items) -> str:
            if not items:
                return "- N/A\n"
            return "".join(f"- {item}\n" for item in items)

        progression = summary.get("score_progression", [])
        prog_lines = ""
        for entry in progression:
            if len(entry) == 3:
                prog_lines += f"{entry[0]} — {entry[1]}/{entry[2]}\n"
            else:
                prog_lines += f"{entry}\n"
        if not prog_lines:
            prog_lines = "N/A\n"

        report = f"""# Final Report

Generated: {datetime.now().strftime("%Y-%m-%d %H:%M")}

## Team

Team name: {get("team_name")}
Members: {get("members")}
Repository: {get("repo")}
Final submission commit hash: {get("commit_hash")}

---

## Final result

Public test score: {get("public_score")}/{get("public_total")}
Final command: {get("run_command")}
Known limitations: {get("known_limitations")}

---

## Models used

Primary model: {get("primary_model")}
Provider/runtime: {get("provider")}
Additional models: {get("additional_models")}
Paid frontier models used after hidden task release: {get("paid_models_used", "no")}
Copilot or paid IDE assistant used after hidden task release: {get("copilot_used", "no")}
Institutional/work/school model quota used: {get("institutional_quota_used", "no")}

---

## Score progression

{prog_lines}
---

## Human interventions

{bullet_list(summary.get("human_interventions"))}
---

## What worked

{bullet_list(summary.get("what_worked"))}
---

## What failed

{bullet_list(summary.get("what_failed"))}
---

## What we would improve

{bullet_list(summary.get("improvements"))}
---

## Notes

{get("notes")}
"""
        with open(self._report_path, "w", encoding="utf-8") as fh:
            fh.write(report)
