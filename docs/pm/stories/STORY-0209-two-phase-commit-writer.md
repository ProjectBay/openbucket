---
id: STORY-0209
title: Two-phase commit `ObjectWriterService`
epic: EPIC-03
status: done
size: M
risk: high
---

## User story
As a developer, I want an `ObjectWriterService.put(cmd)` that performs the canonical write sequence — open transaction → stage and rename blob → upsert pointer row → commit — with disciplined rollback that best-effort unlinks the renamed file on commit failure, so that filesystem and SQLite never diverge under normal operation and the only crash window is the post-rename / pre-commit gap reconciled by the orphan scan in [STORY-0210].

## Description
Implement `ObjectWriterService` exactly per §3.7.2. The order is fixed: `em.fork()` → `em.begin()` → `blobs.putBlob(...)` (stage + atomic rename) → find-or-create the `ObjectEntity` row → set size/etag/contentType/userMetadata/storageClass/softDeleted=false/modifiedAt → if versioned, create the matching `ObjectVersion` row and set `currentVersionId` → `em.commit()`. On any error after rename, `em.rollback()` then `fs.unlink(finalPath)` best-effort with a warning log. This Story owns the *canonical write*; the versioned demote-on-write ordering is layered in [STORY-0213].

## Acceptance criteria
- [x] `ObjectWriterService.put` returns the persisted `ObjectEntity` (TEST-0209 case 1).
- [x] Non-versioned bucket → exactly one `objects` row, zero `object_versions` (case 1); versioned bucket → one row in each, `currentVersionId` matches the new version row (case 2).
- [x] Injected commit failure → `em.rollback()` + best-effort `fs.unlink(finalPath)`; unlink-failure logs `'failed to clean up post-rename file after commit error: …'` (cases 4, 5).
- [x] Successful non-versioned write sets `size`/`etag`/`contentType`/`storageClass = STANDARD`/`softDeleted = false`/`modifiedAt` (case 1).
- [x] Orphan-blob baseline: when commit fails *and* unlink fails, the file remains at the final path with no `objects` row — the input state for STORY-0210 (case 6).

## Tasks
- [TASK-0627] Implement `ObjectWriterService.put` with rollback discipline

## Test plan
- [TEST-0209] Two-phase commit happy path and rollback

## Dependencies
- Blocks: [STORY-0210], [STORY-0213], [EPIC-04]
- Blocked by: [STORY-0201], [STORY-0205], [STORY-0208]

## References
- `docs/WHITEPAPER.md` §3.7.1 (lines 4489–4511), §3.7.2 (lines 4513–4633), §3.7.3 (lines 4635–4644)
- Interfaces produced: `ObjectWriterService.put(cmd: PutObjectCmd): Promise<ObjectEntity>`, `PutObjectCmd`
