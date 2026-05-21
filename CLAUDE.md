## Error handling: better-result

Our own recoverable logic returns `Result<T, E>` (the `better-result` library).
This does NOT mean delete every `throw` — programmer defects and framework edges
(oRPC, TanStack Query, better-auth) stay throw-based.

- Convention + classification table: `docs/error-handling.md`
- Detailed patterns: `.agents/skills/better-result-adopt/SKILL.md`
