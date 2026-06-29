---
id: TASK-0622
title: Implement `BlobStore.getBlob` (range-aware read stream)
story: STORY-0208
status: done
type: implementation
size: XS
---

## Description
Open a `fs.ReadStream` over the on-disk path for `(bucket, key)`, honoring an optional inclusive byte range. Returns the stream plus the total size (so callers can compute `Content-Range`).

## Files to create / modify
- `apps/openbucket-backend/src/storage/blob-store.ts` — modify (add method)

## Implementation notes
- Signature (verbatim from §3.6.3): `async getBlob(bucket: string, key: string, range?: RangeSpec): Promise<{ stream: ReadStream; size: bigint }>`.
- Body (verbatim from §3.6.2):
  ```ts
  const path = this.paths.blobPath(bucket, key);
  const stat = await fs.stat(path);
  const opts: { start?: number; end?: number } = {};
  if (range) {
    opts.start = range.start;
    if (range.end !== undefined) opts.end = range.end;
  }
  const stream = createReadStream(path, opts);
  return { stream, size: BigInt(stat.size) };
  ```
- Per §3.6.2 / §3.6.3 contract: stream lifecycle (abort, backpressure) is the caller's responsibility — the streaming agent ([EPIC-04]) wires `AbortSignal` and Range header parsing around this method.
- Throws `ENOENT` — caller maps to `NoSuchKey`.

## Acceptance criteria
- [ ] `getBlob('b', 'k')` over a known file returns a `ReadStream` whose drained bytes match the source.
- [ ] `getBlob('b', 'k', { start: 5, end: 9 })` returns exactly 5 bytes.
- [ ] Missing file: the call throws an `ENOENT`-coded `NodeJS.ErrnoException`.

## Test obligations
- Unit: covered by [TEST-0208]
- E2E: N/A
- Conformance: N/A

## Dependencies
- Blocked by: [TASK-0620]

## References
- `docs/WHITEPAPER.md` §3.6.2 (lines 4295–4316), §3.6.3 (lines 4471–4479)
