---
id: TEST-0127
title: Object Lock e2e
covers: [STORY-0115, TASK-0355, TASK-0356, TASK-0357]
status: done
level: e2e
---

## Goal
End-to-end verify object-lock configuration, retention, and legal-hold operations.

## Setup
- Boot backend, sign with aws4.

## Cases
1. `PUT /b?object-lock` with `<ObjectLockConfiguration><ObjectLockEnabled>Enabled</ObjectLockEnabled><Rule><DefaultRetention><Mode>GOVERNANCE</Mode><Days>30</Days></DefaultRetention></Rule></ObjectLockConfiguration>` → 200; `GET /b?object-lock` returns the same.
2. `PUT /b/k` then `PUT /b/k?retention` with `<Retention><Mode>GOVERNANCE</Mode><RetainUntilDate>…</RetainUntilDate></Retention>` → 200; `GET /b/k?retention` returns the same.
3. `PUT /b/k?legal-hold` with `<LegalHold><Status>ON</Status></LegalHold>` → 200; `GET /b/k?legal-hold` returns `ON`.

## Tooling
- Framework: jest + supertest + aws4
- Runner: `nx e2e backend-e2e --testPathPattern=object-lock`

## Pass criteria
- [ ] All three cases pass.

## References
- `docs/WHITEPAPER.md` §2.8.2 (lines 2532–2533), §2.8.3 (lines 2559–2562)
