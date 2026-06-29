---
id: STORY-0110
title: Multipart upload operations
epic: EPIC-02
status: done
size: M
risk: high
---

## User story
As an S3 client, I want `CreateMultipartUpload`, `UploadPart`, `UploadPartCopy`, `CompleteMultipartUpload`, `AbortMultipartUpload`, and `ListParts` wired to the `MultipartController`/`ObjectController` dispatch tree, so that large-file uploads via aws-cli `cp`, mc, and AWS SDK v3 work.

## Description
Realize the multipart rows from §2.8.4 (lines 2565–2575). Wiring sits in `ObjectController.put` (uploadPart/uploadPartCopy branches), `ObjectController.post` (createUpload, completeUpload branches), `ObjectController.delete` (abortUpload), and `ObjectController.get` (listParts). The staging of parts and ETag composition belongs to EPIC-04; this Story owns the dispatch wiring and XML envelopes.

## Acceptance criteria
- [ ] `POST /:bucket/:key+?uploads` returns `<InitiateMultipartUploadResult>` with `UploadId`.
- [ ] `PUT /:bucket/:key+?uploadId=…&partNumber=N` stores a part and returns `ETag`.
- [ ] `PUT /:bucket/:key+?uploadId=…&partNumber=N` with `x-amz-copy-source` invokes `multipart.uploadPartCopy`.
- [ ] `POST /:bucket/:key+?uploadId=…` parses XML `<CompleteMultipartUpload>` and returns `<CompleteMultipartUploadResult>` with composed ETag `MD5(concat(MD5(part_i)))-N`.
- [ ] `DELETE /:bucket/:key+?uploadId=…` aborts the upload.
- [ ] `GET /:bucket/:key+?uploadId=…` returns `<ListPartsResult>`.

## Tasks
- [TASK-0341] Implement CreateMultipartUpload
- [TASK-0342] Implement UploadPart
- [TASK-0343] Implement UploadPartCopy
- [TASK-0344] Implement CompleteMultipartUpload
- [TASK-0345] Implement AbortMultipartUpload
- [TASK-0346] Implement ListParts

## Test plan
- [TEST-0117] Multipart e2e
- [TEST-0118] Multipart conformance (aws-cli, mc)

## Dependencies
- Blocked by: [STORY-0100], [STORY-0102], [STORY-0103], [STORY-0106], [EPIC-03], [EPIC-04]

## References
- `docs/WHITEPAPER.md` §2.8.4 (lines 2565–2575)
- Interfaces consumed: `MultipartService` (EPIC-03), streaming part-stage primitive (EPIC-04), `XmlInterceptor`, `SigV4Guard`
