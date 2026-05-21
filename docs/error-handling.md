# Error Handling Convention

This project uses [`better-result`](https://github.com/dmmulroy/better-result) as
its error-handling standard. The detailed migration and usage patterns live in the
`better-result-adopt` skill at `.agents/skills/better-result-adopt/SKILL.md`.

## The rule: classify, then choose

Not every failure becomes a `Result`. Classify the failure first:

| Failure kind        | Examples                                                        | What to do                                   |
| ------------------- | --------------------------------------------------------------- | -------------------------------------------- |
| **Domain error**    | not found, validation failed, unauthorized (in *our* logic)     | `TaggedError` + `Result.err`                 |
| **Infrastructure**  | network, DB, filesystem, JSON parsing                           | `Result.tryPromise` / `Result.try`, map cause |
| **Programmer defect** | impossible state, missing DOM root, broken invariant          | keep `throw` — it's a bug, not a value       |
| **Framework edge**  | oRPC middleware/handlers, TanStack Query `queryFn`, route loaders, better-auth | keep `throw` — the framework contract is throw-based |

"Use better-result" means **all of our own recoverable logic returns
`Result<T, E>`**. It does *not* mean delete every `throw`.

## Boundaries

- Service/business-layer functions return `Result<T, E>` or `Promise<Result<T, E>>`.
- Wrap throwing third-party calls (DB driver, `fetch`, `better-auth`) in
  `Result.tryPromise` at the point of contact.
- At a framework edge that *requires* a throw, do the `Result`-returning work
  internally, then unwrap at the edge: `if (result.isErr()) throw ...`.
- Compose multi-step flows with `Result.gen` / `andThen`, not nested branching.

## Domain error types

Each package defines its own `TaggedError` subclasses in `src/errors.ts`, created
when the package first needs one — not pre-emptively. Preserve `cause`, ids, and
messages so failure context survives.

## Currently kept as `throw` (correctly)

- `packages/api/src/index.ts` — `throw new ORPCError("UNAUTHORIZED")` (framework edge).
- `apps/web/src/main.tsx` — `throw new Error("Root element not found")` (programmer defect).

## Dependency

`better-result` is pinned in the root `package.json` catalog. A package opts in by
adding `"better-result": "catalog:"` to its `package.json` when its code first
imports it — not before, to avoid unused dependencies.
