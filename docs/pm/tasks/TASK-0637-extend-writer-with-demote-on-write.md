---
id: TASK-0637
title: Extend `ObjectWriterService` with demote-on-write step
story: STORY-0213
status: done
type: implementation
size: M
---

## Description
Extend the writer from [TASK-0627] so that on a versioned bucket, the existing current pointer's bytes are first preserved under `<key>.v/<prevVersionId>` (via `fs.link`, falling back to `fs.copyFile` on `EXDEV`) *before* `putBlob` overwrites the pointer file. The corrected order is: `em.begin` → (if versioned and current exists) hard-link or copy → `putBlob` → insert new `ObjectVersion` → update `ObjectEntity.currentVersionId` → `em.commit`.

## Files to create / modify
- `apps/openbucket-backend/src/storage/object-writer.service.ts` — modify (insert demote step)

## Implementation notes
- Corrected order (verbatim from §3.11.3):
  ```
  1. em.begin()
  2. If versioned AND current exists:
       a. Look up previous currentVersionId.
       b. Hard-link or copy blobs/<bucket>/<encoded-key> to <key>.v/<prevVersionId>
          if not already there. (No SQL — only filesystem.)
  3. putBlob(tmp → final)  — atomic rename over the pointer
  4. Insert new ObjectVersion row
  5. Update ObjectEntity.currentVersionId
  6. em.commit()
  ```
- Step 2 is **idempotent**: if `<key>.v/<prevVersionId>` already exists (e.g., from a previous crash-recovery), the link/copy is a no-op. Use `fs.link` first; on `EXDEV` (or `EEXIST` from a prior crash partial state) fall back to `fs.copyFile`, mirroring the `BlobStore.atomicRename` strategy.
- Demote-step pseudocode (extending §3.7.2 between `em.begin()` and `putBlob`):
  ```ts
  const bucketEnt = await em.findOneOrFail(Bucket, { name: cmd.bucket });
  const existing = await em.findOne(ObjectEntity, { bucket: { name: cmd.bucket }, key: cmd.key });
  if (bucketEnt.versioning !== VersioningState.Disabled && existing?.currentVersionId) {
    const src = this.paths.blobPath(cmd.bucket, cmd.key);
    const dst = this.paths.versionPath(cmd.bucket, cmd.key, existing.currentVersionId);
    await fs.mkdir(dirname(dst), { recursive: true });
    try { await fs.link(src, dst); }
    catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'EEXIST') {
        // already preserved by a prior partial write — idempotent
      } else if (code === 'EXDEV') {
        await fs.copyFile(src, dst);
      } else if (code === 'ENOENT') {
        // pointer somehow gone; fall through — putBlob writes from scratch
      } else {
        throw err;
      }
    }
  }
  ```
- The base writer's `ObjectVersion` insert (Step 4) and pointer update (Step 5) continue to use the new `versionId = randomUUID()` from [TASK-0627].
- Per §3.11.4 the suspended-state case (`versionId = "null"`) is handled at the call site / service layer above the writer — out of scope for this Task except to ensure the writer accepts an externally-provided versionId override (optional extension; the spec table is informational).

## Acceptance criteria
- [ ] Two successive PUTs on a versioned bucket produce two `ObjectVersion` rows and a file under `<key>.v/<firstVersionId>` containing the bytes from the *first* PUT.
- [ ] Three successive PUTs produce three `ObjectVersion` rows and two files under `<key>.v/` (the two superseded versions).
- [ ] The demote step is a no-op when `<key>.v/<prevVersionId>` already exists.
- [ ] Forcing `fs.link` to throw `EXDEV` causes `fs.copyFile` to be invoked and the file to land at `<key>.v/<prevVersionId>`.
- [ ] A non-versioned bucket bypasses the demote step entirely (verified by spying on `fs.link`).

## Test obligations
- Unit: covered by [TEST-0213]
- E2E: N/A
- Conformance: N/A

## Dependencies
- Blocked by: [TASK-0627], [TASK-0634]

## References
- `docs/WHITEPAPER.md` §3.11.3 (lines 5144–5178)
