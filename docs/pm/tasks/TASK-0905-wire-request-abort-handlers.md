---
id: TASK-0905
title: Wire request error/aborted handlers to reject hashes and size promises
story: STORY-0301
status: done
type: implementation
size: XS
---

## Description
Attach `'error'` and `'aborted'` listeners to the request and an `'error'` listener to the verifier, so a client disconnect or transport failure rejects the `hashes` / `size` promises and destroys the verifier, but the pipe is **not** explicitly `unpipe()`'d.

## Files to create / modify
- `apps/backend/src/s3/object/put-object.interceptor.ts` — modify

## Implementation notes
- Verbatim wiring per §4.1.2:
  ```ts
  req.on('error', (err) => {
    verifier.destroy(err);
    rejectHashes(err);
    rejectSize(err);
  });
  req.on('aborted', () => {
    const err = new S3Error('RequestAborted', 'Client aborted the request');
    verifier.destroy(err);
    rejectHashes(err);
    rejectSize(err);
  });
  verifier.on('error', (err) => {
    rejectHashes(err);
    rejectSize(err);
  });

  req.pipe(verifier);
  req.openbucketPutCtx = { stream: verifier, hashes, size };
  ```
- **Do not** call `req.unpipe(verifier)` on abort — per §4.1.2 note 3, `destroy()` on the destination detaches the pipe and explicit `unpipe` races with TCP teardown.

## Acceptance criteria
- [ ] `req.on('aborted', ...)` produces `S3Error('RequestAborted', 'Client aborted the request')`.
- [ ] Both promises reject on `req` 'error'.
- [ ] No call to `req.unpipe(...)` exists in this file.

## Test obligations
- Unit: covered by [TEST-0301]
- E2E: covered by [TEST-0304]
- Conformance: covered by [TEST-0302]

## Dependencies
- Blocked by: [TASK-0904]

## References
- `docs/WHITEPAPER.md` §4.1.2 (lines 5368–5402)
