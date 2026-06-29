---
id: TEST-0117
title: Multipart e2e
covers: [STORY-0110, TASK-0341, TASK-0342, TASK-0343, TASK-0344, TASK-0345, TASK-0346]
status: done
level: e2e
---

## Goal
End-to-end verify all multipart endpoints from §2.8.4.

## Setup
- Boot backend, sign with aws4.

## Cases
1. `POST /b/k?uploads` → 200 `<InitiateMultipartUploadResult>` with `UploadId`.
2. `PUT /b/k?uploadId=u&partNumber=1` with 5 MB body → 200, `ETag` header set.
3. `PUT /b/k?uploadId=u&partNumber=2` with 1 KB body → 200, `ETag` set.
4. `GET /b/k?uploadId=u` → `<ListPartsResult>` listing both parts.
5. `POST /b/k?uploadId=u` with `<CompleteMultipartUpload><Part>…</Part>…</CompleteMultipartUpload>` → 200 `<CompleteMultipartUploadResult>` with composed ETag matching `MD5(concat(MD5(part_i)))-2`.
6. `POST /b/k?uploadId=u` with out-of-order parts → 400 `<Code>InvalidPartOrder</Code>`.
7. `POST /b/k?uploadId=u` with a missing part → 400 `<Code>InvalidPart</Code><PartNumber>N</PartNumber>`.
8. `DELETE /b/k?uploadId=u` → 204; `GET /b/k?uploadId=u` → 404 `<Code>NoSuchUpload</Code>`.
9. `PUT /b/k?uploadId=u&partNumber=3` with `x-amz-copy-source: /b/src` → 200 `<CopyPartResult>`.

## Tooling
- Framework: jest + supertest + aws4
- Runner: `nx e2e backend-e2e --testPathPattern=multipart`

## Pass criteria
- [ ] All nine cases pass.

## References
- `docs/WHITEPAPER.md` §2.8.4 (lines 2565–2575)
