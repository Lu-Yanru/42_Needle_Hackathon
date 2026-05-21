import os
import re
import subprocess


def run_public_tests(workspace: str, program_cmd: str) -> dict:
    runner = _find_test_runner(workspace)
    if runner is None:
        return {
            "error": (
                "test_runner not found — expected at "
                "secret_spec/test_runner/run_tests.py or toy_spec/test_runner/run_tests.py"
            ),
            "score": 0,
            "total": 0,
            "failing_categories": [],
            "raw": "",
        }

    # use absolute path so it resolves correctly regardless of cwd
    runner_abs = os.path.abspath(runner)
    cmd = f"python3 {runner_abs} --program '{program_cmd}' --suite public"

    try:
        result = subprocess.run(
            cmd,
            shell=True,
            cwd=workspace,
            capture_output=True,
            text=True,
            timeout=120,
        )
        stdout = result.stdout + (result.stderr if result.returncode != 0 else "")
    except subprocess.TimeoutExpired:
        return {
            "error": "test runner timed out after 120s",
            "score": 0,
            "total": 0,
            "failing_categories": [],
            "raw": "",
        }
    except Exception as e:
        return {
            "error": str(e),
            "score": 0,
            "total": 0,
            "failing_categories": [],
            "raw": "",
        }

    return parse_test_output(stdout)


def parse_test_output(stdout: str) -> dict:
    score_match = re.search(r"SCORE:\s*(\d+)/(\d+)", stdout)
    score = int(score_match.group(1)) if score_match else 0
    total = int(score_match.group(2)) if score_match else 0
    failing = [m.group(1) for m in re.finditer(r"^FAIL:\s*(\S+)", stdout, re.MULTILINE)]
    return {
        "score": score,
        "total": total,
        "failing_categories": failing,
        "raw": stdout,
    }


def _find_test_runner(workspace: str) -> str | None:
    candidates = [
        os.path.join(workspace, "secret_spec", "test_runner", "run_tests.py"),
        os.path.join("secret_spec", "test_runner", "run_tests.py"),
        os.path.join(workspace, "toy_spec", "test_runner", "run_tests.py"),
        os.path.join("toy_spec", "test_runner", "run_tests.py"),
    ]
    for path in candidates:
        if os.path.exists(path):
            return path
    return None
