---
id: TASK-0621
title: Implement `BlobStore.putBlob` (stage + hash + fsync + rename)
story: STORY-0208
status: done
type: implementation
size: M
---

## Description
Implement the atomic-stage-then-rename write primitive. Streams the source into `tmp/put-<uuid>`, hashes MD5 and SHA-256 inline by tapping `'data'`, `fsync`s the tmp file, then atomic-renames to the final path. On any error, best-effort unlink the tmp file and rethrow.

## Files to create / modify
- `apps/openbucket-backend/src/storage/blob-store.ts` — new (scaffolds `BlobStore`, adds `putBlob`)

## Implementation notes
- Class skeleton: `@Injectable() export class BlobStore { private readonly log = new Logger(BlobStore.name); private readonly paths: PathResolver; constructor(config: ConfigService) { this.paths = new PathResolver(config.getOrThrow<string>('DATA_DIR')); } ... }`.
- Export interfaces:
  - `interface PutResult { size: bigint; etag: string; sha256: string; finalPath: string; }`
  - `interface RangeSpec { start: number; end?: number; }`
  - `interface HeadResult { size: bigint; mtime: Date; }`
  - `interface BlobRef { path: string; size: bigint; }`
- Method signature (verbatim from §3.6.3 contracts): `async putBlob(bucket: string, key: string, source: Readable | string): Promise<PutResult>`.
- Sequence (verbatim from §3.6.2):
  1. `await this.ensureDir(this.paths.tmpDir());`
  2. `const tmpName = \`put-${randomUUID()}\`; const tmpPath = this.paths.tmpPath(tmpName); const finalPath = this.paths.blobPath(bucket, key);`
  3. `const md5 = createHash('md5'); const sha = createHash('sha256'); let bytesWritten = 0n;`
  4. `const sink = createWriteStream(tmpPath, { flags: 'wx' });`
  5. `const input: Readable = typeof source === 'string' ? createReadStream(source) : source;`
  6. Attach `'data'` listener that updates both hashes and `bytesWritten += BigInt(chunk.length);`.
  7. `await pipeline(input, sink);`
  8. `await this.fsyncFile(tmpPath);`
  9. On any thrown error: `await this.unlinkQuiet(tmpPath); throw err;`.
  10. `await this.ensureDir(dirname(finalPath));`
  11. `await this.atomicRename(tmpPath, finalPath);` (implemented in TASK-0626).
  12. Return `{ size: bytesWritten, etag: md5.digest('hex'), sha256: sha.digest('hex'), finalPath };`.
- Helpers needed locally: `ensureDir(path)`, `unlinkQuiet(path)`, `fsyncFile(path)` (open in `'r+'`, `await fh.sync()`, close).

## Acceptance criteria
- [ ] Streaming a 10 MB random buffer into `putBlob('b', 'k')` lands at `DATA_DIR/blobs/b/k` with the returned MD5 matching `crypto.createHash('md5').update(buf).digest('hex')`.
- [ ] On a thrown `Error` from the source mid-stream, the tmp file is gone and the final path does not exist.
- [ ] The tmp file is opened with `'wx'` (verified by attempting a parallel call with the same tmp name failing with `EEXIST`).

## Test obligations
- Unit: covered by [TEST-0208]
- E2E: N/A (covered indirectly by [TEST-0209])
- Conformance: N/A

## Dependencies
- Blocked by: [TASK-0620], [TASK-0626]

## References
- `docs/WHITEPAPER.md` §3.6.2 (lines 4241–4293), §3.6.3 (lines 4471–4479)
