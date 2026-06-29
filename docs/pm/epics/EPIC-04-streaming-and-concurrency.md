---
id: EPIC-04
title: Streaming I/O, concurrency & background work
status: backlog
whitepaper_section: "§4"
owner_area: streaming
---

## Objective

Make the I/O hot path correct and bounded: stream PUT bodies through
hash+size-cap into the persistence layer's `putBlob`, stream GET
responses with proper fd cleanup, parse and honor single-range
requests, implement the full multipart upload lifecycle including
the 5 MiB minimum and the multipart-ETag computation, calibrate
server timeouts for object-storage workloads, configure the libuv
thread pool, document concurrency invariants under POSIX semantics,
and run the in-process background scheduler that drives the
lifecycle sweep, multipart cleanup, trash purge, and orphan scan
without piling up.

## Scope

- In scope:
  - `RawReq` decorator and `PutObjectInterceptor` (Content-MD5 verify, `x-amz-content-sha256` verify, size cap, backpressure).
  - Streaming GET handler with header ordering and fd cleanup on disconnect.
  - Single-range parsing + 416 for multi-range.
  - Multipart Initiate / UploadPart (with `O_EXCL` collision handling) / Complete (5 MiB minimum + multipart-ETag computation) / Abort.
  - Server timeouts: `requestTimeout=0`, `keepAliveTimeout=75s`, `headersTimeout=60s`.
  - `UV_THREADPOOL_SIZE=16` before any `require`.
  - Explicit 256 KB highWaterMark and ~1 MiB per-PUT buffer ceiling.
  - Concurrency invariants table (PUT same key, multipart part collisions, etc.).
  - `BackgroundService` with no-pile-up semantics and per-tick `RequestContext.create`.
  - `LifecycleSweepRunner` with cursor pagination, `setImmediate` yields, days-vs-date evaluation.
  - `Clock` abstraction (`SystemClock` / `TestClock`) plus the gated `/api/admin/_test/advance-clock` endpoint when `OPENBUCKET_TEST_MODE=1`.
  - `ShutdownService` 5-step ordering.
- Out of scope:
  - Nest module wiring, classifier middleware, ConfigModule — owned by EPIC-01.
  - S3 wire-protocol XML, route definitions, SigV4 — owned by EPIC-02.
  - MikroORM entities, BlobStore internals — owned by EPIC-03 (this Epic *consumes* the `BlobStore` and `*Service` interfaces).
  - Admin endpoints, JWT, frontend, Docker, CI — owned by EPIC-05 / EPIC-06.

## Success criteria

- A 1 GiB PUT streams to disk with bounded memory and the resulting blob equals the upstream MD5.
- A GET with `Range: bytes=100-199` returns 206 and exactly 100 bytes.
- A multipart upload with 5 parts completes successfully; the final ETag is `MD5(concat(MD5(part_i)))-5`.
- Aborting a multipart upload removes the staging directory and rows.
- The background scheduler does not pile up if a tick runs long.
- A SIGTERM during a PUT drains the request and rejects new ones within 30 s.

## Stories

- [STORY-0300] RawReq decorator for unbuffered request streams
- [STORY-0301] PutObjectInterceptor with hash, size-cap, and MD5/SHA256 verification
- [STORY-0302] PUT object handler streaming to BlobStore
- [STORY-0303] GET object handler streaming from disk with fd cleanup
- [STORY-0304] Single-range HTTP Range header parser
- [STORY-0305] InitiateMultipartUpload handler
- [STORY-0306] UploadPart handler with O_EXCL staging and per-part ETag
- [STORY-0307] CompleteMultipartUpload with 5 MiB minimum and multipart-ETag
- [STORY-0308] AbortMultipartUpload handler
- [STORY-0309] HTTP server timeouts calibrated for object storage
- [STORY-0310] UV_THREADPOOL_SIZE=16 before any require
- [STORY-0311] Backpressure invariants and explicit highWaterMark settings
- [STORY-0312] Concurrency invariants doc and O_EXCL collision tolerance
- [STORY-0313] BackgroundService scheduler with no-pile-up semantics
- [STORY-0314] LifecycleSweepRunner with cursor pagination and days/date eval
- [STORY-0315] MultipartCleanupRunner tick
- [STORY-0316] TrashPurgeRunner tick
- [STORY-0317] OrphanScanRunner one-shot at bootstrap
- [STORY-0318] Clock abstraction with TestClock and OPENBUCKET_TEST_MODE advance endpoint
- [STORY-0319] ShutdownService 5-step ordering with stream drain deadline

## Dependencies

- Blocks: [EPIC-02], [EPIC-06]
- Blocked by: [EPIC-01], [EPIC-03]

## References

- `docs/WHITEPAPER.md` §4 (lines 5193–6658)
  - §4.1 Streaming PUT — request body to disk in one pipe (lines 5213–5522)
  - §4.2 Streaming GET — disk to response, one read stream (lines 5523–5630)
  - §4.3 Range requests — single-range only for v1 (lines 5631–5719)
  - §4.4 Multipart upload streaming (lines 5720–6035)
  - §4.5 Server timeouts — calibrated for object storage (lines 6036–6107)
  - §4.6 libuv thread pool — `UV_THREADPOOL_SIZE=16` (lines 6108–6139)
  - §4.7 Backpressure & memory (lines 6140–6174)
  - §4.8 Concurrency invariants (lines 6175–6204)
  - §4.9 Background tick scheduler (lines 6205–6329)
  - §4.10 Lifecycle sweep implementation (lines 6330–6446)
  - §4.11 Test/clock injection (lines 6447–6546)
  - §4.12 Shutdown coordination (lines 6547–6658)
- `docs/ARCHITECTURE.md` §8, §9
- `docs/BACKEND-DESIGN.md` §3
