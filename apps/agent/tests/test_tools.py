"""
test_tools.py — Self-contained tests for src/agent/tools.py

Run from the repo root:
    python3 test_tools.py

All tests use stdlib only (no pytest required).
Exit code 0 = all passed. Exit code 1 = at least one failure.
"""

import os
import sys
import shutil
import tempfile

# Allow running from anywhere: add src/ (sibling of tests/) to sys.path so
# `import agent` works without an editable install. If you ran `uv sync`,
# this is a no-op.
_REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(_REPO_ROOT, "src"))

from agent.tools import (
    read_file,
    write_file,
    list_dir,
    run_command,
    take_snapshot,
    restore_snapshot,
    clear_snapshots,
    snapshot_exists,
)

PASS = "\033[92mPASS\033[0m"
FAIL = "\033[91mFAIL\033[0m"
failures = []


def check(label: str, condition: bool, detail: str = "") -> None:
    if condition:
        print(f"  {PASS}  {label}")
    else:
        msg = f"{label}" + (f" — {detail}" if detail else "")
        print(f"  {FAIL}  {msg}")
        failures.append(msg)


def section(title: str) -> None:
    print(f"\n{title}")
    print("-" * len(title))


# ---------------------------------------------------------------------------
# Setup
# ---------------------------------------------------------------------------
tmp = tempfile.mkdtemp(prefix="tools_test_")
clear_snapshots()


# ---------------------------------------------------------------------------
# read_file
# ---------------------------------------------------------------------------
section("read_file")

check(
    "missing file returns empty string",
    read_file(f"{tmp}/does_not_exist.txt") == "",
)

write_file(f"{tmp}/read_test.txt", "hello world")
check(
    "reads back written content",
    read_file(f"{tmp}/read_test.txt") == "hello world",
)

write_file(f"{tmp}/unicode.txt", "こんにちは 🌍")
check(
    "handles unicode content",
    read_file(f"{tmp}/unicode.txt") == "こんにちは 🌍",
)

write_file(f"{tmp}/empty.txt", "")
check(
    "empty file returns empty string",
    read_file(f"{tmp}/empty.txt") == "",
)


# ---------------------------------------------------------------------------
# write_file
# ---------------------------------------------------------------------------
section("write_file")

nested = f"{tmp}/a/b/c/nested.txt"
write_file(nested, "deep")
check(
    "creates nested parent directories",
    os.path.isfile(nested),
)
check(
    "nested file content is correct",
    open(nested).read() == "deep",
)

overwrite = f"{tmp}/overwrite.txt"
write_file(overwrite, "first")
write_file(overwrite, "second")
check(
    "overwrites existing file",
    open(overwrite).read() == "second",
)


# ---------------------------------------------------------------------------
# list_dir
# ---------------------------------------------------------------------------
section("list_dir")

list_root = f"{tmp}/list_test"
os.makedirs(list_root, exist_ok=True)
write_file(f"{list_root}/a.py", "x")
write_file(f"{list_root}/b.py", "y")
write_file(f"{list_root}/sub/c.txt", "z")
write_file(f"{list_root}/.hidden", "h")
os.makedirs(f"{list_root}/__pycache__", exist_ok=True)
open(f"{list_root}/__pycache__/junk.pyc", "w").close()

listing = list_dir(list_root)

check("includes a.py", "a.py" in listing, str(listing))
check("includes b.py", "b.py" in listing, str(listing))
check(
    "includes nested sub/c.txt",
    os.path.join("sub", "c.txt") in listing or "sub/c.txt" in listing,
    str(listing),
)
check("excludes .hidden files", ".hidden" not in listing, str(listing))
check(
    "excludes __pycache__",
    not any("__pycache__" in p for p in listing),
    str(listing),
)

check(
    "non-existent dir returns empty list",
    list_dir(f"{tmp}/no_such_dir") == [],
)


# ---------------------------------------------------------------------------
# run_command
# ---------------------------------------------------------------------------
section("run_command")

result = run_command("echo hello", cwd=tmp)
check("exit code 0 on success", result["exit_code"] == 0, str(result))
check("stdout contains output", "hello" in result["stdout"], str(result))
check("timed_out is False", result["timed_out"] is False)
check("command field is set", result["command"] == "echo hello")
check("timestamp field is set", bool(result.get("timestamp")))

result = run_command("exit 42", cwd=tmp)
check("captures non-zero exit code", result["exit_code"] == 42, str(result))

result = run_command("echo err >&2; exit 1", cwd=tmp)
check("captures stderr", "err" in result["stderr"], str(result))

result = run_command("sleep 10", cwd=tmp, timeout=1)
check("timeout sets timed_out=True", result["timed_out"] is True, str(result))
check("timeout sets exit_code=-1", result["exit_code"] == -1, str(result))

result = run_command("cat /dev/stdin", cwd=tmp, timeout=1)
# should time out or return non-zero — just must not raise
check(
    "hanging command does not raise",
    isinstance(result, dict),
    str(result),
)


# ---------------------------------------------------------------------------
# Snapshot / rollback
# ---------------------------------------------------------------------------
section("snapshot / rollback")

clear_snapshots()

snap_file = f"{tmp}/snap.txt"
write_file(snap_file, "original")
clear_snapshots()              # clear auto-snapshot from write_file

take_snapshot(snap_file)
check("snapshot_exists after take_snapshot", snapshot_exists(snap_file))

write_file(snap_file, "modified")
check("file was modified", read_file(snap_file) == "modified")

ok = restore_snapshot(snap_file)
check("restore_snapshot returns True", ok is True)
check(
    "content restored to original",
    read_file(snap_file) == "original",
    repr(read_file(snap_file)),
)

# Snapshot of a file that doesn't exist → restore should delete it
new_file = f"{tmp}/brand_new.txt"
assert not os.path.isfile(new_file)
take_snapshot(new_file)        # records None (file absent)
write_file(new_file, "agent created this")
check("new file exists before restore", os.path.isfile(new_file))
restore_snapshot(new_file)
check(
    "restore of None snapshot deletes the file",
    not os.path.isfile(new_file),
)

# restore on unknown path returns False
check(
    "restore unknown path returns False",
    restore_snapshot(f"{tmp}/never_snapped.txt") is False,
)

# clear_snapshots empties the store
take_snapshot(snap_file)
check("snapshot exists before clear", snapshot_exists(snap_file))
clear_snapshots()
check("snapshot gone after clear_snapshots", not snapshot_exists(snap_file))


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