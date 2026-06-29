---
id: TEST-0310
title: Multipart conformance with real S3 clients
covers: [STORY-0305, STORY-0306, STORY-0307, STORY-0308]
status: backlog
level: conformance
---

## Goal
Verify the multipart wire surface against `aws-cli`, `mc`, and `@aws-sdk/client-s3` so we are wire-compatible with both the official CLI and the v3 SDK.

## Setup
- Build the OpenBucket Docker image.
- Start the container; configure each client.

## Cases
1. **aws-cli multipart PUT**: `aws s3 cp 50MB.bin s3://bucket/big` (default threshold triggers multipart). Verify final ETag matches `<md5>-<N>` formula by recomputing client-side.
2. **aws-cli abort**: trigger an aborted multipart (via `aws s3api abort-multipart-upload`); assert subsequent `list-multipart-uploads` no longer lists it.
3. **mc multipart PUT**: `mc cp 50MB.bin alias/bucket/big`; same ETag formula check.
4. **@aws-sdk/client-s3 (v3) multipart PUT** via `Upload` from `@aws-sdk/lib-storage`; same ETag formula check.
5. **@aws-sdk/client-s3 part ETag matches recomputed MD5** for each part (caught from `UploadPartCommand` response).
6. **Cross-client read**: PUT via aws-cli multipart, GET via mc; bytes identical.

## Tooling
- Framework: aws-cli, mc, @aws-sdk/client-s3
- Runner: `nx run conformance:run`

## Pass criteria
- [ ] All six cases pass.

## References
- `docs/WHITEPAPER.md` §4.4 (lines 5720–6032)
