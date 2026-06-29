---
id: TEST-0125
title: Lifecycle e2e
covers: [STORY-0114, TASK-0354]
status: done
level: e2e
---

## Goal
End-to-end verify lifecycle configuration round-trip.

## Setup
- Boot backend, sign with aws4.

## Cases
1. `PUT /b?lifecycle` with `<LifecycleConfiguration><Rule><ID>r1</ID><Status>Enabled</Status><Expiration><Days>30</Days></Expiration></Rule></LifecycleConfiguration>` → 200.
2. `GET /b?lifecycle` returns the same; verify `Rule` is an array even with one rule.
3. `PUT /b?lifecycle` with two rules and a `<Transition>` element → 200; `GET` returns both.
4. `DELETE /b?lifecycle` → 204; `GET /b?lifecycle` → 404 `<Code>NoSuchLifecycleConfiguration</Code>`.

## Tooling
- Framework: jest + supertest + aws4
- Runner: `nx e2e backend-e2e --testPathPattern=lifecycle`

## Pass criteria
- [ ] All four cases pass.

## References
- `docs/WHITEPAPER.md` §2.8.2 (lines 2523–2525)
