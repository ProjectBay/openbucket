---
id: TEST-0306
title: GET object e2e via supertest (incl. range and 416)
covers: [STORY-0303, STORY-0304]
status: done
level: e2e
---

## Goal
End-to-end GET through the Nest pipeline against a real fs blob.

## Setup
- Test Nest app with `:memory:` SQLite and a temp blob dir.
- Pre-PUT a 1000-byte object with known bytes.

## Cases
1. `GET /<bucket>/<key>` → HTTP 200, body length 1000, `Content-Length: 1000`, `ETag` quoted hex MD5.
2. `GET /<bucket>/missing` → HTTP 404 (`NoSuchKey`).
3. `GET /<bucket>/<key>` with `Range: bytes=100-199` → HTTP 206, 100 bytes, `Content-Range: bytes 100-199/1000`, `Content-Length: 100`.
4. `Range: bytes=-50` → HTTP 206, 50 bytes (last 50), `Content-Range: bytes 950-999/1000`.
5. `Range: bytes=500-` → HTTP 206, 500 bytes, `Content-Range: bytes 500-999/1000`.
6. `Range: bytes=1000-2000` → HTTP 416, `Content-Range: bytes */1000`, empty body.
7. `Range: bytes=0-99,200-299` → HTTP 416 (multi-range rejected in v1).
8. `Range: items=0-99` → HTTP 416 (non-bytes unit).
9. Client disconnects mid-stream (abort the supertest request) — fd is released (best-effort assertion: open-fd count returns to baseline within 100 ms).

## Tooling
- Framework: supertest, jest
- Runner: `nx e2e backend-e2e --testPathPattern=get-object.e2e-spec.ts`

## Pass criteria
- [ ] All nine cases pass.

## References
- `docs/WHITEPAPER.md` §4.2 (lines 5523–5627), §4.3 (lines 5631–5717)
