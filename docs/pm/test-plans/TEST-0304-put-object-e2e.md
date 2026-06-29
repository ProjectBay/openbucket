---
id: TEST-0304
title: PUT object e2e via supertest
covers: [STORY-0301, STORY-0302]
status: done
level: e2e
---

## Goal
End-to-end PUT through the real Nest pipeline (interceptor + handler + BlobStore + ObjectService) using supertest, with a real fs but an in-memory SQLite.

## Setup
- Build the test Nest app with `:memory:` SQLite (BlobStore provider points to a temp dir).
- Pre-create the destination bucket.

## Cases
1. PUT a 1 KiB body with correct `Content-MD5` and `x-amz-content-sha256` → HTTP 200, `ETag` matches the body's MD5, a subsequent HEAD returns the same `ETag` and `Content-Length: 1024`.
2. PUT with a wrong `Content-MD5` → HTTP 400, `BadDigest`.
3. PUT with a wrong hex `x-amz-content-sha256` → HTTP 400, `XAmzContentSHA256Mismatch`.
4. PUT with `x-amz-content-sha256: UNSIGNED-PAYLOAD` and no `Content-MD5` → HTTP 200, body persisted.
5. PUT without `x-amz-content-sha256` → HTTP 400, `InvalidRequest`.
6. PUT a body that exceeds `maxObjectSizeMb` → HTTP 400, `EntityTooLarge`.
7. PUT closed mid-stream (simulate `req.destroy()`) → connection error; no row in `objects`; no file in `blobs/`.

## Tooling
- Framework: supertest, jest
- Runner: `nx e2e backend-e2e --testPathPattern=put-object.e2e-spec.ts`

## Pass criteria
- [ ] All seven cases pass.
- [ ] No tmp file left under `<dataDir>/tmp/` after a failed PUT.

## References
- `docs/WHITEPAPER.md` §4.1 (lines 5213–5519)
