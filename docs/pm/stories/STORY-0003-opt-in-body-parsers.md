---
id: STORY-0003
title: Implement opt-in body parsers for admin routes
epic: EPIC-01
status: done
size: XS
risk: low
---

## User story
As a developer, I want JSON and url-encoded body parsers mounted only under `/api/admin/*`, so that S3 PUT requests keep `req` as a raw stream while admin payloads are parsed normally.

## Description
Implement `apps/backend/src/bootstrap/body-parser.ts` exporting `configureBodyParsers(app: Express): void`. Mount `json({ limit: '1mb', strict: true })` and `urlencoded({ limit: '1mb', extended: false })` on the `/api/admin` prefix only. S3 paths and `/admin/*` SPA paths must remain unparsed.

## Acceptance criteria
- [ ] `configureBodyParsers` exported with the exact signature `(app: Express) => void`.
- [ ] JSON / form parsers mounted only under `/api/admin`.
- [ ] An S3 path receives `req` as a readable stream (verified by an integration test that pipes the body).
- [ ] Admin payloads >1 MiB are rejected by Express's parser with the documented error.

## Tasks
- [TASK-0007] Implement configureBodyParsers helper

## Test plan
- [TEST-0003] Body parsing scope (unit)

## Dependencies
- Blocks: [STORY-0002]
- Blocked by: [STORY-0001]

## References
- `docs/WHITEPAPER.md` §1.2.2 (lines 199–224)
- Interfaces produced: `configureBodyParsers` (consumed by STORY-0002)
