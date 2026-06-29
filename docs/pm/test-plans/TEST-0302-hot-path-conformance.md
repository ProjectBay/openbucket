---
id: TEST-0302
title: PUT/GET/range/multipart hot-path conformance with real S3 clients
covers: [STORY-0301, STORY-0302, STORY-0303, STORY-0304, STORY-0305, STORY-0306, STORY-0307, STORY-0308, STORY-0311]
status: backlog
level: conformance
---

## Goal
Exercise the built OpenBucket container with three independent S3 clients (`aws-cli`, `mc`, `s3cmd`) to confirm the hot path (PUT, GET, GET with Range, full multipart lifecycle) is wire-compatible.

## Setup
- Build the OpenBucket Docker image (owned by EPIC-06; this Test Plan consumes its tag).
- Start the container with a temp `DATA_DIR`.
- Configure each client with the root access keys baked into the test env (EPIC-05).

## Cases
1. **aws-cli — small PUT/GET**: `aws s3 cp small.txt s3://bucket/key`; `aws s3 cp s3://bucket/key fetched.txt`; assert bytes equal and `ETag` is the upstream MD5.
2. **aws-cli — multi-GB PUT (multipart)**: `aws s3 cp 50MB.bin s3://bucket/large` (default multipart threshold triggers multipart); verify a subsequent GET returns identical bytes and a multipart-form ETag `<md5>-<N>`.
3. **aws-cli — GET with Range**: `aws s3api get-object --range bytes=100-199 ...`; assert HTTP 206, 100 bytes returned, `Content-Range: bytes 100-199/<size>`.
4. **mc — PUT/GET parity** mirrors case 1 using `mc cp`.
5. **mc — multipart abort**: `mc cp` interrupted then `mc rm` of the in-flight upload; assert `AbortMultipartUpload` removed the staging directory.
6. **s3cmd — PUT/GET parity** mirrors case 1 using `s3cmd put` / `s3cmd get`.
7. **All clients — invalid range**: `Range: bytes=1000-2000` against a 500-byte object returns HTTP 416 with `Content-Range: bytes */500`.
8. **All clients — multi-range rejected**: `Range: bytes=0-99,200-299` returns HTTP 416 (v1 single-range only).

## Tooling
- Framework: aws-cli, mc, s3cmd
- Runner: `nx run conformance:run`

## Pass criteria
- [ ] All eight cases pass on each of the three clients (where the client supports the operation).
- [ ] No client emits a body-parser / chunked-encoding warning against OpenBucket.

## References
- `docs/WHITEPAPER.md` §4.1 (lines 5213–5519), §4.2 (lines 5523–5627), §4.3 (lines 5631–5717), §4.4 (lines 5720–6032)
