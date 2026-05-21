"""
Prompt templates for the agent loop.

Each template uses .format(**state) — keep placeholders in {curly_braces}.
The model MUST respond with a single JSON object matching ACTION_SCHEMA
(see run_agent.py). Any prose outside the JSON will be rejected and retried.

Phases:
  PLANNING_PROMPT     — once, at the start. Produces a plan JSON, no code.
  IMPLEMENTING_PROMPT — loops until tests run cleanly the first time.
  FIXING_PROMPT       — loops while there are failing test categories.
"""

PLANNING_PROMPT = """You are a coding agent. Read this specification carefully.

SPECIFICATION:
---
{spec}
---

Your ONLY task right now is to produce an implementation plan.
Do NOT write any code yet. Do NOT call any tools.

Respond with a single JSON object, no prose, matching this shape:
{{
  "plan": ["step 1", "step 2", "..."],
  "entrypoint": "solution.py",
  "run_command": "python3 solution.py <args>",
  "required_inputs": "describe input format",
  "required_outputs": "describe output format",
  "edge_cases": ["case 1", "case 2"]
}}
"""

IMPLEMENTING_PROMPT = """You are a coding agent implementing a plan.

PLAN:
{plan}

CURRENT WORKSPACE FILES:
{files}

LAST TEST RESULT:
{last_test_result}

Write or edit ONE file to make progress on the plan.
Do NOT add features beyond the spec. Do NOT add debug prints to stdout.

Respond with a single JSON object, no prose:
{{
  "action": "write_file",
  "path": "relative/path/from/workspace.py",
  "content": "full file contents",
  "reasoning": "one sentence on what this change does"
}}

Or if implementation is complete and you want to run tests:
{{
  "action": "run_command",
  "command": "python3 solution.py ...",
  "reasoning": "ready to test"
}}
"""

FIXING_PROMPT = """You are a coding agent fixing failing tests.

PLAN:
{plan}

CURRENT FILE CONTENTS:
{files}

TEST RESULT: {score}/{total}
FAILING CATEGORIES: {failing_categories}

FAILING TEST EXAMPLES:
{failure_samples}

RULES:
- Fix ONE failing category at a time. Pick the one most likely a simple bug.
- Do NOT rewrite the whole file. Edit minimally.
- Do NOT add debug prints to stdout — they break the test harness.
- After your edit, tests will rerun automatically. Score regression = your patch is rolled back.

Respond with a single JSON object, no prose:
{{
  "action": "write_file",
  "path": "relative/path/from/workspace.py",
  "content": "full file contents",
  "reasoning": "one sentence: which category, what fix"
}}
"""

# Used when the agent has stalled (3 iterations, no score improvement).
# Forces a step back instead of another patch attempt.
STUCK_ANALYSIS_PROMPT = """You have tried 3 patches with no score improvement.

PLAN:
{plan}

CURRENT FILE CONTENTS:
{files}

LAST FAILING CATEGORY: {failing_category}
LAST 3 PATCH ATTEMPTS:
{recent_attempts}

Do NOT propose another patch yet. First analyze WHY this category keeps failing.
Then propose a DIFFERENT approach than the last 3 attempts.

Respond with a single JSON object, no prose:
{{
  "action": "write_file",
  "path": "relative/path/from/workspace.py",
  "content": "full file contents with a meaningfully different approach",
  "reasoning": "why previous attempts failed + what's different now"
}}
"""
