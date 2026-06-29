---
id: TEST-0108
title: Presigned URL e2e and conformance
covers: [STORY-0104, TASK-0316]
status: done
level: conformance
---

## Goal
End-to-end verify presigned GET and PUT work with the AWS SDK presigner and `aws s3 presign`.

## Setup
- Boot the backend with a fixture access key.
- Client matrix:
  - `aws s3 presign s3://b/k --endpoint-url <url>` (aws-cli)
  - `@aws-sdk/s3-request-presigner` (JS SDK v3)
  - `mc share download` (mc) — optional, where supported.

## Cases
1. Given a presigned GET URL for an existing object, when GET via curl, then 200 and the bytes match.
2. Given a presigned PUT URL for a new key, when PUT via curl with `-T file`, then 200 and the object is created.
3. Given a presigned URL with `X-Amz-Expires` already elapsed, when GET, then 403 `<Code>AccessDenied</Code><Message>Request has expired</Message>`.
4. Given a presigned URL where the signature is replaced with `0`*64, when GET, then 403 `<Code>SignatureDoesNotMatch</Code>`.

## Tooling
- Framework: aws-cli, @aws-sdk/s3-request-presigner, curl, jest+supertest
- Runner: `nx run conformance:run --suite=presigned`

## Pass criteria
- [ ] All cases pass via at least the aws-cli and JS SDK clients.

## References
- `docs/WHITEPAPER.md` §2.5 (lines 1985–2131)
