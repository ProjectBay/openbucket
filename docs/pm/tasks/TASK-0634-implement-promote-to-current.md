---
id: TASK-0634
title: Implement `VersionStoreService.promoteToCurrent`
story: STORY-0213
status: done
type: implementation
size: M
---

## Description
Implement the restore operation that promotes a stored non-current version back to the bucket's current pointer. Used by lifecycle ("keep one past version") and admin-side restore. Same two-phase commit discipline as §3.7.

## Files to create / modify
- `apps/openbucket-backend/src/storage/version-store.service.ts` — new (scaffold + `promoteToCurrent`)

## Implementation notes
- Class skeleton:
  ```ts
  @Injectable()
  export class VersionStoreService {
    private readonly paths: PathResolver;
    constructor(
      private readonly em: EntityManager,
      private readonly blobs: BlobStore,
      config: ConfigService,
    ) {
      this.paths = new PathResolver(config.getOrThrow<string>('DATA_DIR'));
    }
    ...
  }
  ```
- `promoteToCurrent(bucket: string, key: string, versionId: string): Promise<void>` (verbatim sequence from §3.11.2):
  1. `const em = this.em.fork(); await em.begin();`
  2. `const ver = await em.findOne(ObjectVersion, { bucket: { name: bucket }, key, versionId });`
  3. `if (!ver || ver.isDeleteMarker) throw new NotFoundException('version not found or is a delete marker');`
  4. `const versionPath = this.paths.versionPath(bucket, key, versionId); await fs.stat(versionPath);`
  5. `await this.blobs.composeBlobs([{ path: versionPath, size: ver.size }], bucket, key);` — cheapest copy with atomic rename.
  6. `const row = await em.findOneOrFail(ObjectEntity, { bucket: { name: bucket }, key });`
  7. Copy fields: `row.currentVersionId = versionId; row.size = ver.size; row.etag = ver.etag; row.contentType = ver.contentType; row.userMetadata = ver.userMetadata; row.softDeleted = false; row.modifiedAt = new Date();`
  8. `em.persist(row); await em.commit();`
  9. Catch: `await em.rollback().catch(() => undefined); throw err;`.
- Per §3.11.2 docstring: "Update `ObjectEntity.currentVersionId` in the same EM transaction that wraps the rename — same two-phase commit discipline as §3.7."

## Acceptance criteria
- [ ] After `promoteToCurrent(bucket, key, vid)`, the file at the current-pointer path has the same bytes as `<key>.v/<vid>`.
- [ ] `ObjectEntity.currentVersionId === vid` after the call.
- [ ] Calling with a `versionId` that maps to `isDeleteMarker = true` throws `NotFoundException`.
- [ ] Calling with an unknown `versionId` throws `NotFoundException`.
- [ ] A simulated failure between `composeBlobs` and `em.commit()` triggers `em.rollback()`.

## Test obligations
- Unit: covered by [TEST-0213]
- E2E: N/A
- Conformance: N/A

## Dependencies
- Blocked by: [TASK-0606], [TASK-0613], [TASK-0620], [TASK-0625]

## References
- `docs/WHITEPAPER.md` §3.11.2 (lines 4977–5056)
