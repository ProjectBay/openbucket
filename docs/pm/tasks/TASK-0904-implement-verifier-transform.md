---
id: TASK-0904
title: Implement the verifier Transform with hash, size cap, and digest verification
story: STORY-0301
status: done
type: implementation
size: S
---

## Description
Build the `Transform` inside `PutObjectInterceptor` that incrementally feeds `md5` and `sha256`, tracks total `bytes`, throws `EntityTooLarge` when `bytes > maxBytes`, and on `flush` finalizes the digests, compares them against `expectedMd5Base64` / `expectedSha256`, and resolves the `hashes` and `size` promises.

## Files to create / modify
- `apps/backend/src/s3/object/put-object.interceptor.ts` — modify

## Implementation notes
- Use `highWaterMark: 256 * 1024` verbatim per §4.7.
- `transform` body verbatim:
  ```ts
  transform(chunk: Buffer, _enc, cb: TransformCallback) {
    bytes += chunk.length;
    if (bytes > maxBytes) {
      aborted = true;
      return cb(new S3Error('EntityTooLarge', `Object exceeds ${maxBytes} bytes`));
    }
    md5.update(chunk);
    sha256.update(chunk);
    cb(null, chunk);
  },
  ```
- `flush` body verbatim:
  ```ts
  flush(cb: TransformCallback) {
    if (aborted) return cb();
    const md5Hex = md5.digest('hex');
    const md5Buf = Buffer.from(md5Hex, 'hex');
    const md5Base64 = md5Buf.toString('base64');
    const sha256Hex = sha256.digest('hex');

    if (expectedMd5Base64 && expectedMd5Base64 !== md5Base64) {
      return cb(new S3Error('BadDigest', 'Content-MD5 mismatch'));
    }
    if (verifySha && expectedSha256.toLowerCase() !== sha256Hex) {
      return cb(new S3Error('XAmzContentSHA256Mismatch', 'x-amz-content-sha256 mismatch'));
    }
    resolveHashes({ md5Hex, md5Base64, sha256Hex });
    resolveSize(bytes);
    cb();
  },
  ```
- `maxBytes = this.config.maxObjectSizeMb * 1024 * 1024`.

## Acceptance criteria
- [ ] Stream emits `EntityTooLarge` when total bytes exceed `maxBytes`.
- [ ] On success, `hashes` resolves with `{ md5Hex, md5Base64, sha256Hex }`.
- [ ] `Content-MD5` mismatch emits `BadDigest`.
- [ ] `x-amz-content-sha256` hex mismatch (when not unsigned) emits `XAmzContentSHA256Mismatch`.

## Test obligations
- Unit: covered by [TEST-0301]
- E2E: covered by [TEST-0304]
- Conformance: covered by [TEST-0302]

## Dependencies
- Blocked by: [TASK-0903]

## References
- `docs/WHITEPAPER.md` §4.1.2 (lines 5332–5365), §4.7 (line 6161)
