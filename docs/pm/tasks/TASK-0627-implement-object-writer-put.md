---
id: TASK-0627
title: Implement `ObjectWriterService.put` with rollback discipline
story: STORY-0209
status: done
type: implementation
size: M
---

## Description
Implement the canonical two-phase commit write: open EM transaction, stage and rename blob (via `BlobStore.putBlob`), upsert the `ObjectEntity` row (and an `ObjectVersion` row if the bucket is versioned), commit. On any error after rename, rollback the transaction and best-effort unlink the renamed file with a warning log.

## Files to create / modify
- `apps/openbucket-backend/src/storage/object-writer.service.ts` — new

## Implementation notes
- Class skeleton (verbatim from §3.7.2): `@Injectable() export class ObjectWriterService { private readonly log = new Logger(ObjectWriterService.name); constructor(private readonly em: EntityManager, private readonly blobs: BlobStore) {} ... }`.
- `interface PutObjectCmd { bucket: string; key: string; body: Readable; contentType?: string; userMetadata?: Record<string, string>; }`.
- `put(cmd: PutObjectCmd): Promise<ObjectEntity>`. Sequence (verbatim from §3.7.2):
  1. `const em = this.em.fork(); await em.begin();`
  2. `const put = await this.blobs.putBlob(cmd.bucket, cmd.key, cmd.body); finalPath = put.finalPath;`
  3. `const bucket = await em.findOneOrFail(Bucket, { name: cmd.bucket });`
  4. `let row = await em.findOne(ObjectEntity, { bucket: { name: cmd.bucket }, key: cmd.key });`
  5. If `!row`: `row = new ObjectEntity(); row.id = randomUUID(); row.bucket = bucket; row.key = cmd.key;`
  6. Set `row.size = put.size; row.etag = put.etag; row.contentType = cmd.contentType ?? 'application/octet-stream'; row.userMetadata = cmd.userMetadata; row.storageClass = StorageClass.Standard; row.softDeleted = false; row.modifiedAt = new Date();`
  7. If `bucket.versioning !== VersioningState.Disabled`: create an `ObjectVersion` via `em.create(ObjectVersion, { ... isDeleteMarker: false, ... })` with a fresh `versionId = randomUUID()`, set `row.currentVersionId = versionId`, `em.persist(ver)`.
  8. `em.persist(row); await em.commit(); return row;`.
- Catch block:
  ```ts
  await em.rollback().catch(() => undefined);
  if (finalPath) {
    try { await fs.unlink(finalPath); } catch (unlinkErr) {
      this.log.warn(
        `failed to clean up post-rename file after commit error: ${finalPath}: ${(unlinkErr as Error).message}`,
      );
    }
  }
  throw err;
  ```
- The crash window is documented in §3.7.3: post-rename, pre-commit. Reconciled by [STORY-0210]. The reverse failure (row committed, file missing) is prevented by construction — row is written only after rename succeeds.
- This Task implements the *base* writer. The versioned demote-on-write ordering (§3.11.3) is added in [TASK-0637].

## Acceptance criteria
- [ ] Successful PUT on a fresh non-versioned bucket inserts exactly one `objects` row with the put's size/etag, no `object_versions` row.
- [ ] Successful PUT on a versioned bucket inserts both an `objects` row with `currentVersionId` set and a matching `object_versions` row with `isDeleteMarker = false`.
- [ ] Forced commit failure (e.g. drop the table mid-call) triggers `em.rollback()` and `fs.unlink(finalPath)`; the warning log fires only if the unlink also fails.
- [ ] A successful subsequent PUT on the same `(bucket, key)` updates the existing row rather than inserting a duplicate (unique constraint stays clean).

## Test obligations
- Unit: covered by [TEST-0209]
- E2E: covered by [TEST-0210] (uses this writer to set up the crash)
- Conformance: N/A

## Dependencies
- Blocked by: [TASK-0605], [TASK-0606], [TASK-0613], [TASK-0621]

## References
- `docs/WHITEPAPER.md` §3.7.1 (lines 4489–4511), §3.7.2 (lines 4513–4633), §3.7.3 (lines 4635–4644)
