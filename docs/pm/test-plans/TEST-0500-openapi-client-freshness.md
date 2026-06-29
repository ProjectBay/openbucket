---
id: TEST-0500
title: OpenAPI client freshness CI check
covers: [STORY-0500, TASK-1500, TASK-1501, TASK-1502]
status: done
level: e2e
---

## Goal
Verify the OpenAPI generation pipeline is end-to-end deterministic: regenerating the client from the exported spec on a clean tree produces zero git diff against the committed `libs/api-client/src/lib`; any drift fails CI with a clear hint.

## Setup
- Clean checkout of the repo (no local edits).
- `npm ci --no-audit --no-fund` complete.
- Node 22, all OpenAPI pipeline dev deps installed ([TASK-1504]).

## Cases
1. **Fresh tree, fresh client.** Given a clean checkout where the committed `libs/api-client/src/lib` matches the current backend controllers, when CI runs `nx run api-client:check`, then the command exits 0.
2. **Stale committed client.** Given a tree where a backend controller signature was changed but the api-client was not regenerated, when CI runs `nx run api-client:check`, then `git diff --exit-code -- libs/api-client/src/lib` fails and the hint `api-client is stale — run: nx run api-client:generate && commit` appears in the CI log.
3. **Spec export idempotence.** Given two back-to-back invocations of `nx run backend:openapi:export` on an unchanged tree, when both finish, then the two emitted `apps/backend/dist/openapi.json` files are byte-equal.
4. **Operation IDs are bare method names.** Given the exported `openapi.json`, when grepping for `"operationId"`, then no value matches `^[A-Z][A-Za-z]+Controller_`; all values are bare method names like `"listBuckets"`.

## Tooling
- Framework: jest (for case 3/4 assertions if scripted) and the Nx CLI for case 1/2.
- Runner: `nx run api-client:check`, `nx run backend:openapi:export`.
- Optional: a tiny Node script under `tools/check-operation-ids.ts` for case 4.

## Pass criteria
- [ ] Case 1 returns exit 0 in CI.
- [ ] Case 2 fails CI with the stale-client hint visible in the log.
- [ ] Case 3 produces byte-equal JSON.
- [ ] Case 4 finds no `Controller_`-prefixed operation IDs.

## References
- `docs/WHITEPAPER.md` §5.16 (lines 8325–8450)
