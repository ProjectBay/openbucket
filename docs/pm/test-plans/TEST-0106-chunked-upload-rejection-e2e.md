---
id: TEST-0106
title: Chunked-upload signing rejection e2e
covers: [STORY-0103, TASK-0315]
status: backlog
level: e2e
---

## Goal
Verify the documented v1 decision: any request carrying `x-amz-content-sha256: STREAMING-AWS4-HMAC-SHA256-PAYLOAD` is rejected with `400 InvalidArgument` and the canonical XML body from §2.4.6.

## Setup
- Boot the backend with a fixture access key. supertest.

## Cases
1. Given `PUT /b/k` with header `x-amz-content-sha256: STREAMING-AWS4-HMAC-SHA256-PAYLOAD` and a valid SigV4, when sent, then 400 and body contains:
   ```
   <Error>
     <Code>InvalidArgument</Code>
     <Message>STREAMING-AWS4-HMAC-SHA256-PAYLOAD is not supported. Set x-amz-content-sha256: UNSIGNED-PAYLOAD instead.</Message>
     <ArgumentName>x-amz-content-sha256</ArgumentName>
     <ArgumentValue>STREAMING-AWS4-HMAC-SHA256-PAYLOAD</ArgumentValue>
   </Error>
   ```
2. Given `PUT /b/k` with `x-amz-content-sha256: STREAMING-UNSIGNED-PAYLOAD-TRAILER`, when sent (and the body is otherwise valid), then it is *not* rejected by the chunked-upload guard (status depends on body validity).
3. Given `aws s3 cp ./file s3://b/k --endpoint-url …` (default chunked signing), when run, the AWS CLI surfaces the InvalidArgument; documented workaround `--no-payload-signing` succeeds.

## Tooling
- Framework: jest + supertest + aws-cli (case 3)
- Runner: `nx e2e backend-e2e --testPathPattern=chunked-rejection`

## Pass criteria
- [ ] Cases 1, 2 pass via supertest.
- [ ] Case 3 documented in README compatibility notes; manual run confirms `--no-payload-signing` succeeds.

## References
- `docs/WHITEPAPER.md` §2.4.6 (lines 1946–1981)
