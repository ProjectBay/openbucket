---
id: TASK-0631
title: Define `TrashManifest` interface and verify `deleteBlob` writes it
story: STORY-0211
status: done
type: implementation
size: XS
---

## Description
Define the `TrashManifest` TypeScript interface — the on-disk schema for every soft-deleted blob's manifest written by `BlobStore.deleteBlob`. Also document the write-after-move ordering (manifest is written *after* the rename into `trash/`), and the purge tick's policy for unmanifested trash files ("purge after grace period").

## Files to create / modify
- `apps/openbucket-backend/src/storage/trash.ts` — new (or co-located with `blob-store.ts` — choose `trash.ts` so [EPIC-04]'s purge tick can import it without pulling in the full `BlobStore`)

## Implementation notes
- Interface (verbatim from §3.9):
  ```ts
  export interface TrashManifest {
    entryId: string;          // matches the trash filename
    bucket: string;           // raw bucket name
    key: string;              // raw S3 key
    originalPath: string;     // absolute path the blob was renamed from
    deletedAt: string;        // ISO-8601
    scheduledPurgeAt?: string;// ISO-8601 — set by lifecycle service when applicable
  }
  ```
- Add a one-line module-level comment quoting §3.9's invariant: "Writing the manifest happens **after** the blob is renamed into trash. If the manifest write fails, the file remains in trash without a manifest — the purge tick treats unmanifested trash files as 'purge after grace period' with a configurable default grace."
- `BlobStore.deleteBlob` ([TASK-0624]) writes the JSON exactly as this interface — verify by importing the type in the BlobStore unit test and parsing the written file.
- Per §3.9: no SQLite table for trash entries in v1. Filesystem is source of truth.

## Acceptance criteria
- [ ] `TrashManifest` exported and used as the parse target in [TEST-0211].
- [ ] `BlobStore.deleteBlob` writes JSON that round-trips through `JSON.parse` and satisfies the interface (`entryId`, `bucket`, `key`, `originalPath`, `deletedAt` all present and string-typed).
- [ ] `scheduledPurgeAt` is omitted by `deleteBlob` (set later by the lifecycle service).

## Test obligations
- Unit: covered by [TEST-0211]
- E2E: N/A
- Conformance: N/A

## Dependencies
- Blocked by: [TASK-0624]

## References
- `docs/WHITEPAPER.md` §3.9 (lines 4804–4825)
