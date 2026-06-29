---
id: TASK-0624
title: Implement `BlobStore.deleteBlob` (move-to-trash + manifest)
story: STORY-0208
status: done
type: implementation
size: S
---

## Description
Move the blob into `<DATA_DIR>/trash/<uuid>` and write a sibling JSON manifest. Idempotent under `ENOENT`. The actual unlink runs later in [EPIC-04]'s trash-purge background tick.

## Files to create / modify
- `apps/openbucket-backend/src/storage/blob-store.ts` — modify (add method)

## Implementation notes
- Signature (verbatim from §3.6.3): `async deleteBlob(bucket: string, key: string): Promise<void>`.
- Body (verbatim from §3.6.2):
  ```ts
  const src = this.paths.blobPath(bucket, key);
  await this.ensureDir(this.paths.trashDir());

  const entryId = randomUUID();
  const dst = join(this.paths.trashDir(), entryId);

  try {
    await this.atomicRename(src, dst);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      // Already gone — idempotent.
      return;
    }
    throw err;
  }

  const manifest = {
    entryId,
    bucket,
    key,
    originalPath: src,
    deletedAt: new Date().toISOString(),
  };
  await fs.writeFile(`${dst}.manifest.json`, JSON.stringify(manifest, null, 2));
  ```
- Manifest schema is `TrashManifest` — defined in [TASK-0631] (same module file or `./trash.ts`).
- Manifest write happens *after* the rename: a partial failure leaves the trash file without manifest, which the purge tick treats as "purge after grace period" per §3.9.

## Acceptance criteria
- [ ] After `deleteBlob('b', 'k')`, the file at `blobs/b/<encoded-k>` no longer exists and a single file under `trash/` with `.manifest.json` sibling does.
- [ ] Calling `deleteBlob` on a missing key returns without error (idempotent).
- [ ] The manifest JSON parses back to the `TrashManifest` shape and `originalPath` matches the input path.

## Test obligations
- Unit: covered by [TEST-0208], schema by [TEST-0211]
- E2E: N/A
- Conformance: N/A

## Dependencies
- Blocked by: [TASK-0620], [TASK-0626]

## References
- `docs/WHITEPAPER.md` §3.6.2 (lines 4332–4361), §3.9 (lines 4804–4825)
