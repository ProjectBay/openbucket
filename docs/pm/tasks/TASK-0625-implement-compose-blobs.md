---
id: TASK-0625
title: Implement `BlobStore.composeBlobs` (multi-part concatenation)
story: STORY-0208
status: done
type: implementation
size: M
---

## Description
Concatenate an ordered list of `BlobRef`s into a single staged file in `tmp/`, hashing inline, then atomic-rename to `(destBucket, destKey)`. Used by `CompleteMultipartUpload` and by version restore.

## Files to create / modify
- `apps/openbucket-backend/src/storage/blob-store.ts` — modify (add method)

## Implementation notes
- Signature (verbatim from §3.6.3): `async composeBlobs(parts: BlobRef[], destBucket: string, destKey: string): Promise<PutResult>`.
- Sequence (verbatim from §3.6.2):
  1. `await this.ensureDir(this.paths.tmpDir());`
  2. `const tmpName = \`compose-${randomUUID()}\`;` `const tmpPath = this.paths.tmpPath(tmpName);` `const finalPath = this.paths.blobPath(destBucket, destKey);`
  3. Open `sink = createWriteStream(tmpPath, { flags: 'wx' });`.
  4. For each part, `createReadStream(part.path)`, tap `'data'` for MD5/SHA-256/`bytesWritten`, and pipe into `sink` with `{ end: false }`; await `'end'` per part.
  5. After the loop, end the sink with a Promise wrapper that resolves on the callback; then `await this.fsyncFile(tmpPath);`.
  6. On any error, `await this.unlinkQuiet(tmpPath); throw err;`.
  7. `await this.ensureDir(dirname(finalPath)); await this.atomicRename(tmpPath, finalPath);`.
  8. Return `{ size: bytesWritten, etag: md5.digest('hex'), sha256: sha.digest('hex'), finalPath }`.
- Per §3.6.2: this method returns the *raw single-blob MD5*. The multipart S3 ETag (`<md5-of-concatenated-part-md5s>-<N>`) is derived by the service layer from per-part ETags — out of scope here.

## Acceptance criteria
- [ ] Composing three parts of known content produces a final file whose bytes equal `Buffer.concat([p1, p2, p3])`.
- [ ] The returned `etag` matches `MD5(Buffer.concat([p1, p2, p3])).hex`.
- [ ] On a thrown read error for the middle part, the tmp file is unlinked and the final path does not exist.
- [ ] `parts: []` produces a 0-byte file at `finalPath` with the MD5 of the empty string.

## Test obligations
- Unit: covered by [TEST-0208]
- E2E: N/A
- Conformance: N/A

## Dependencies
- Blocked by: [TASK-0620], [TASK-0626]

## References
- `docs/WHITEPAPER.md` §3.6.2 (lines 4363–4421), §3.6.3 (lines 4471–4479)
