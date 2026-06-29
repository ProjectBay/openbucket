---
id: TEST-0135
title: ListObjectsV2 pagination e2e
covers: [STORY-0118, TASK-0363]
status: done
level: e2e
---

## Goal
End-to-end verify `GET /:bucket?list-type=2` paginates correctly via `continuation-token`.

## Setup
- Boot backend with a populated bucket of 2500 keys (so 3 pages at default 1000 max-keys).

## Cases
1. `GET /b?list-type=2` → 200, `KeyCount=1000`, `IsTruncated=true`, `NextContinuationToken` present.
2. `GET /b?list-type=2&continuation-token=<token>` → 200, next page of 1000 keys, `IsTruncated=true`.
3. Third page → `IsTruncated=false`, no `NextContinuationToken`.
4. `GET /b?list-type=2&continuation-token=tampered` → 400 `<Code>InvalidArgument</Code>`.
5. `GET /b?list-type=2&continuation-token=<token-from-other-bucket>` → 400 `<Code>InvalidArgument</Code>`.
6. `GET /b?list-type=2&max-keys=10&prefix=foo/` honours both filters.

## Tooling
- Framework: jest + supertest + aws4
- Runner: `nx e2e backend-e2e --testPathPattern=list-objects-v2`

## Pass criteria
- [ ] All six cases pass.

## References
- `docs/WHITEPAPER.md` §2.10 (lines 2689–2814)
