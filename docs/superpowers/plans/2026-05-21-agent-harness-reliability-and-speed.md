# Agent Harness Reliability And Speed Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the agent harness avoid placeholder commands, stop feeding stale workspace junk to the model, and cut repeated failure thrash so runs become reliable and materially faster.

**Architecture:** Add a small pure helper layer for plan normalization and failure summarization, then wire the loop to use those helpers when planning, prompting, and testing. Keep the existing phase machine, but reduce wasted context and repeated command loops rather than redesigning the whole harness.

**Tech Stack:** Bun, TypeScript, Bun test, existing agent loop/logger/event system

---

### Task 1: Lock Pure Harness Behavior With Tests

**Files:**
- Create: `apps/agent/src/harness-helpers.test.ts`
- Create: `apps/agent/src/harness-helpers.ts`

- [ ] Add tests for command sanitization, focused workspace context, and repeated-failure summaries.
- [ ] Run: `bun test apps/agent/src/harness-helpers.test.ts`
- [ ] Expect: FAIL because helper module/functions do not exist yet.

### Task 2: Normalize Model Plans Before The Loop Uses Them

**Files:**
- Modify: `apps/agent/src/loop.ts`
- Modify: `apps/agent/src/prompts.ts`
- Modify: `apps/agent/src/self-tests.ts`
- Modify: `apps/agent/src/harness-helpers.ts`

- [ ] Sanitize placeholder-filled `run_command` values to an executable base command derived from the entrypoint.
- [ ] Make self-tests and smoke runs use the sanitized base command instead of placeholder-bearing plan text.
- [ ] Remove placeholder-bearing run command text from prompts where it misleads the model.

### Task 3: Reduce Prompt Noise And Workspace Pollution

**Files:**
- Modify: `apps/agent/src/loop.ts`
- Modify: `apps/agent/src/prompts.ts`
- Modify: `apps/agent/src/workspace.ts`
- Modify: `apps/agent/src/harness-helpers.ts`

- [ ] Show the model a focused workspace view centered on the plan entrypoint instead of dumping stale workspace files.
- [ ] Shorten failure context so fixing/stuck prompts only receive the actionable tail signal.
- [ ] Add a repeated-command guard so identical failing commands are not run in long loops inside the same phase.

### Task 4: Verify The Harness End To End

**Files:**
- Modify: `apps/agent/src/harness-helpers.test.ts`
- Modify: `apps/agent/src/self-tests.test.ts` (only if needed)

- [ ] Run: `bun test`
- [ ] Run: `bun run typecheck`
- [ ] Run a dry run command against the password spec and inspect `.needle-agent/run.jsonl` for fewer calls and sanitized commands.
