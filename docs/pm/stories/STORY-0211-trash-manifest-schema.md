---
id: STORY-0211
title: Trash manifest schema and write-after-move ordering
epic: EPIC-03
status: done
size: XS
risk: low
---

## User story
As a developer, I want the `TrashManifest` TypeScript interface and the deterministic write-after-move ordering that `BlobStore.deleteBlob` uses, so that the trash-purge background tick owned by [EPIC-04] has a stable on-disk record describing every soft-deleted blob, with the rule that an unmanifested trash file still gets purged after the default grace period.

## Description
Define `TrashManifest` exactly per §3.9 as a TypeScript interface co-located with `BlobStore` (it is the type of the sibling `<uuid>.manifest.json` file written by `deleteBlob`). Document the discipline: manifest is written *after* the blob has been renamed into trash, so a partial failure leaves a file with no manifest — which the purge tick treats as "purge after grace period". No SQLite table is added; the filesystem is the source of truth. This Story is a thin contract producer; `deleteBlob` itself is implemented in [STORY-0208].

## Acceptance criteria
- [x] `TrashManifest` exported from `apps/openbucket-backend/src/storage/trash.ts` with the six §3.9 fields.
- [x] `BlobStore.deleteBlob` annotates its manifest as `TrashManifest`; TEST-0211 round-trips the JSON and confirms the field set (case 2) and TypeScript narrowing (case 7).
- [x] `deletedAt` is ISO-8601 (`new Date(deletedAt).toISOString() === deletedAt`, case 6); `scheduledPurgeAt` is intentionally *not* set by `deleteBlob` (it's the lifecycle service's job).
- [x] No new SQLite tables; the filesystem manifest is the source of truth.

## Tasks
- [TASK-0631] Define `TrashManifest` interface and verify `deleteBlob` writes it

## Test plan
- [TEST-0211] Trash manifest round-trip

## Dependencies
- Blocks: [EPIC-04] (purge tick consumes the manifest schema)
- Blocked by: [STORY-0208]

## References
- `docs/WHITEPAPER.md` §3.9 (lines 4804–4825)
- Interfaces produced: `TrashManifest`
