---
id: TASK-0628
title: Implement `RecoveryService` blob pass with `walk` and `decodeKey` lookup
story: STORY-0210
status: done
type: implementation
size: M
---

## Description
Implement the blob half of the orphan scan: walk every file under `blobs/<bucket>/...`, skip `*.v/` version subdirectories, decode the relative path via `decodeKey` to recover the raw S3 key, look up `(bucket, key)` in `objects` (fields-projected to `id`), and append unmatched files to `OrphanReport.orphanBlobs`. Never unlink in v1.

## Files to create / modify
- `apps/openbucket-backend/src/storage/recovery.service.ts` — new (scaffold + blob pass)

## Implementation notes
- Class skeleton:
  ```ts
  @Injectable()
  export class RecoveryService implements OnApplicationBootstrap {
    private readonly log = new Logger(RecoveryService.name);
    private readonly paths: PathResolver;
    constructor(private readonly em: EntityManager, config: ConfigService) {
      this.paths = new PathResolver(config.getOrThrow<string>('DATA_DIR'));
    }
    // onApplicationBootstrap implemented in TASK-0630
    async runScan(): Promise<OrphanReport> { ... }
  }
  ```
- `interface OrphanReport { orphanBlobs: { path: string; bucket: string; key: string }[]; removedMultipartDirs: string[]; scanned: { blobs: number; multipart: number }; }`.
- Blob-pass body (verbatim from §3.8):
  - `const blobsRoot = this.paths.blobsDir();`
  - If exists, iterate `await fs.readdir(blobsRoot, { withFileTypes: true })`; for each `isDirectory()` entry, recurse via the internal `walk(bucketRoot)`.
  - For each file path under a bucket: `const rel = relative(bucketRoot, filePath);` skip `*.v/` segments with `if (rel.includes('.v' + '/') || rel.includes('.v' + '\\')) continue;`.
  - Decode: `const decoded = decodeKey(rel.replaceAll('\\', '/'));`.
  - Lookup: `const row = await this.em.findOne(ObjectEntity, { bucket: { name: bucket }, key: decoded }, { fields: ['id'] });`.
  - If `!row`: push `{ path: filePath, bucket, key: decoded }` into `orphanBlobs`.
  - Increment `blobsScanned` per file visited.
- Async generator `walk(root)` (verbatim from §3.8): iterative DFS using a stack; on `ENOENT` from `readdir`, skip; emits files only (not directories).
- Per §3.8 last paragraph: **never auto-delete** orphan blobs in v1 — logging is the safe default to protect a misconfigured `DATA_DIR`.

## Acceptance criteria
- [ ] An orphan file placed manually under `blobs/<bucket>/<encoded-key>` is detected and included in `OrphanReport.orphanBlobs` with the *raw* key.
- [ ] A file under `blobs/<bucket>/<encoded-key>.v/<versionId>` is *not* reported as an orphan (skipped).
- [ ] No file under `blobs/` is unlinked by the scan.
- [ ] Walking a missing `blobs/` directory does not throw.

## Test obligations
- Unit: covered by [TEST-0210] (also exercised as e2e for the crash injection)
- E2E: covered by [TEST-0210]
- Conformance: N/A

## Dependencies
- Blocked by: [TASK-0613], [TASK-0619], [TASK-0620]

## References
- `docs/WHITEPAPER.md` §3.8 (lines 4648–4736), §3.8 (lines 4767–4796)
