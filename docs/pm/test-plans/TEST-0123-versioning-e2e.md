---
id: TEST-0123
title: Versioning e2e
covers: [STORY-0113, TASK-0353]
status: done
level: e2e
---

## Goal
End-to-end verify bucket versioning configuration round-trip.

## Setup
- Boot backend, sign with aws4.

## Cases
1. `PUT /b?versioning` with `<VersioningConfiguration><Status>Enabled</Status></VersioningConfiguration>` → 200; `GET /b?versioning` returns `Enabled`.
2. `PUT /b?versioning` with `Status: Suspended` → 200; `GET /b?versioning` returns `Suspended`.
3. `GET /b?versioning` on a bucket where versioning was never set → empty `<VersioningConfiguration/>`.

## Tooling
- Framework: jest + supertest + aws4
- Runner: `nx e2e backend-e2e --testPathPattern=versioning`

## Pass criteria
- [ ] All three cases pass.

## References
- `docs/WHITEPAPER.md` §2.8.2 (lines 2521–2522)
