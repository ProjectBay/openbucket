---
id: TEST-0119
title: Tagging / ACL / Policy e2e
covers: [STORY-0111, TASK-0347, TASK-0348, TASK-0349, TASK-0350, TASK-0351]
status: done
level: e2e
---

## Goal
End-to-end verify bucket and object tagging, ACL, and policy round-trip.

## Setup
- Boot backend, sign with aws4.

## Cases
1. `PUT /b?tagging` with `<Tagging><TagSet><Tag><Key>env</Key><Value>prod</Value></Tag></TagSet></Tagging>` → 200; `GET /b?tagging` returns the same document.
2. `DELETE /b?tagging` → 204; `GET /b?tagging` → 404 `<Code>NoSuchTagSet</Code>`.
3. `PUT /b/k?tagging` round-trips, then `DELETE /b/k?tagging` clears.
4. `GET /b?acl` always returns owner-full ACL.
5. `PUT /b?acl` with any well-formed `<AccessControlPolicy>` → 200 (no-op).
6. `PUT /b?policy` with a JSON document → 200; `GET /b?policy` returns the JSON verbatim with `Content-Type: application/json`.
7. `DELETE /b?policy` → 204; `GET /b?policy` → 404 `<Code>NoSuchBucketPolicy</Code>`.

## Tooling
- Framework: jest + supertest + aws4
- Runner: `nx e2e backend-e2e --testPathPattern=tagging-acl-policy`

## Pass criteria
- [ ] All seven cases pass.

## References
- `docs/WHITEPAPER.md` §2.8.2 (lines 2513–2517, 2526–2528), §2.8.3 (lines 2553–2557)
