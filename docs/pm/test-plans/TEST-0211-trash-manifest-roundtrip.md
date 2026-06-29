---
id: TEST-0211
title: Trash manifest round-trip
covers: [STORY-0211, TASK-0631]
status: done
level: unit
---

## Goal
Verify `BlobStore.deleteBlob` writes a JSON manifest that round-trips through `JSON.parse` into a value satisfying the `TrashManifest` interface — the contract consumed by [EPIC-04]'s trash-purge background tick.

## Setup
- Real temporary `DATA_DIR`.
- Instantiate `BlobStore` with the temp path.
- Pre-populate one blob via `putBlob('b', 'photos/2026/may.jpg', Readable.from(buf))`.

## Cases
1. After `deleteBlob('b', 'photos/2026/may.jpg')`, exactly one `<uuid>.manifest.json` file exists under `trash/`.
2. `JSON.parse(<manifest content>)` yields an object whose keys are exactly `{ entryId, bucket, key, originalPath, deletedAt }` — `scheduledPurgeAt` is *not* set by `deleteBlob` (it's the lifecycle service's job).
3. `entryId` matches the trash file's filename (without `.manifest.json` suffix).
4. `bucket === 'b'` and `key === 'photos/2026/may.jpg'` (raw, not encoded).
5. `originalPath` is an absolute path ending with the encoded form `photos/2026/may.jpg` (slash-preserved, no percent-encoding for these chars).
6. `deletedAt` parses as a valid ISO-8601 timestamp via `new Date(deletedAt).toISOString() === deletedAt`.
7. Importing the parsed object via TypeScript narrowing `const m: TrashManifest = JSON.parse(raw);` type-checks without error.

## Tooling
- Framework: jest
- Runner: `nx test backend --testPathPattern=trash-manifest.spec.ts`

## Pass criteria
- [x] All seven cases pass (`apps/openbucket-backend/src/storage/trash-manifest.spec.ts`); backend suite 143/143.

## References
- `docs/WHITEPAPER.md` §3.9 (lines 4804–4825)
