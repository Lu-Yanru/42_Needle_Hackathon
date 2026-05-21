"""
tools.py — File I/O, shell execution, and snapshot/rollback helpers for the agent loop.

All functions are stateless except for the module-level _snapshots dict,
which is intentionally global so B's run_agent.py can call take_snapshot/
restore_snapshot without passing state around.
"""

import os
import subprocess
from datetime import datetime
from typing import Optional

# ---------------------------------------------------------------------------
# Snapshot store (in-memory, keyed by absolute path)
# ---------------------------------------------------------------------------
_snapshots: dict[str, Optional[str]] = {}


# ---------------------------------------------------------------------------
# File helpers
# ---------------------------------------------------------------------------

def read_file(path: str) -> str:
    """Read and return the full text content of a file.

    Returns an empty string if the file does not exist, so callers
    can safely read before checking existence.
    """
    path = os.path.abspath(path)
    if not os.path.isfile(path):
        return ""
    with open(path, "r", encoding="utf-8", errors="replace") as fh:
        return fh.read()


def write_file(path: str, content: str) -> None:
    """Write content to a file, creating parent directories as needed.

    A snapshot of the previous content is taken automatically before
    overwriting so restore_snapshot() can undo the change.
    """
    path = os.path.abspath(path)
    # Always snapshot before writing so rollback is possible
    take_snapshot(path)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(content)


def list_dir(path: str) -> list[str]:
    """Return a sorted list of relative file paths under a directory.

    Hidden files/dirs (starting with '.') and __pycache__ are excluded
    to keep the context sent to the model clean.
    """
    path = os.path.abspath(path)
    if not os.path.isdir(path):
        return []
    result = []
    for root, dirs, files in os.walk(path):
        # Prune in-place so os.walk skips hidden dirs and pycache
        dirs[:] = sorted(
            d for d in dirs if not d.startswith(".") and d != "__pycache__"
        )
        for fname in sorted(files):
            if fname.startswith("."):
                continue
            abs_path = os.path.join(root, fname)
            result.append(os.path.relpath(abs_path, path))
    return result


# ---------------------------------------------------------------------------
# Shell command runner
# ---------------------------------------------------------------------------

def run_command(
    cmd: str,
    cwd: str = ".",
    timeout: int = 60,
) -> dict:
    """Run a shell command and return stdout, stderr, and exit code.

    Args:
        cmd:     Shell command string (passed to bash -c).
        cwd:     Working directory for the command.
        timeout: Seconds before the process is killed (default 60).

    Returns:
        {
            "stdout":    str,
            "stderr":    str,
            "exit_code": int,
            "timed_out": bool,
            "command":   str,
            "timestamp": str,
        }
    """
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    cwd = os.path.abspath(cwd)

    try:
        proc = subprocess.run(
            cmd,
            shell=True,
            cwd=cwd,
            capture_output=True,
            text=True,
            timeout=timeout,
        )
        return {
            "stdout": proc.stdout,
            "stderr": proc.stderr,
            "exit_code": proc.returncode,
            "timed_out": False,
            "command": cmd,
            "timestamp": timestamp,
        }
    except subprocess.TimeoutExpired:
        return {
            "stdout": "",
            "stderr": f"Command timed out after {timeout}s: {cmd}",
            "exit_code": -1,
            "timed_out": True,
            "command": cmd,
            "timestamp": timestamp,
        }
    except Exception as exc:  # noqa: BLE001
        return {
            "stdout": "",
            "stderr": f"Exception running command: {exc}",
            "exit_code": -1,
            "timed_out": False,
            "command": cmd,
            "timestamp": timestamp,
        }


# ---------------------------------------------------------------------------
# Snapshot / rollback
# ---------------------------------------------------------------------------

def take_snapshot(path: str) -> None:
    """Save the current content of a file to the in-memory snapshot store.

    If the file does not exist, None is stored so restore_snapshot can
    delete the file to undo a creation.
    """
    path = os.path.abspath(path)
    if os.path.isfile(path):
        with open(path, "r", encoding="utf-8", errors="replace") as fh:
            _snapshots[path] = fh.read()
    else:
        _snapshots[path] = None  # file didn't exist before


def restore_snapshot(path: str) -> bool:
    """Restore a file to its snapshotted state.

    Returns True if a snapshot existed and was applied, False otherwise.
    If the snapshot was None (file didn't exist), the file is deleted.
    """
    path = os.path.abspath(path)
    if path not in _snapshots:
        return False

    previous = _snapshots[path]
    if previous is None:
        # File was created by the agent — remove it to undo
        if os.path.isfile(path):
            os.remove(path)
    else:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf-8") as fh:
            fh.write(previous)
    return True


def clear_snapshots() -> None:
    """Discard all snapshots (call after a successful test run)."""
    _snapshots.clear()


def snapshot_exists(path: str) -> bool:
    """Return True if a snapshot for the given path is stored."""
    return os.path.abspath(path) in _snapshots
