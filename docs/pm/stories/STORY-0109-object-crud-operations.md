---
id: STORY-0109
title: Object CRUD operations
epic: EPIC-02
status: done
size: M
risk: high
---

## User story
As an S3 client, I want `PutObject`, `GetObject`, `HeadObject`, `DeleteObject`, `CopyObject`, `PostObject` (browser form), `RestoreObject`, `GetObjectAttributes`, and `GetObjectTorrent` (NotImplemented) wired to the controller dispatch tree, so that I can manage individual object bytes and metadata.

## Description
Realize the object rows from §2.8.3 (lines 2542–2563). The body-streaming, range-response, and copy-source plumbing belong to EPIC-04; this Story wires the dispatch branches in `ObjectController` (per §2.1.1) onto the domain handlers and surfaces the proper headers and XML envelopes.

## Acceptance criteria
- [ ] `PUT /:bucket/:key+` without `x-amz-copy-source` calls `objects.putObject` (delegating body streaming to EPIC-04).
- [ ] `PUT /:bucket/:key+` with `x-amz-copy-source` calls `objects.copyObject` and returns `<CopyObjectResult>`.
- [ ] `GET /:bucket/:key+` honours `Range`, `If-Match`, `If-None-Match`, `If-Modified-Since`, `If-Unmodified-Since`.
- [ ] `HEAD /:bucket/:key+` returns headers only, never a body.
- [ ] `DELETE /:bucket/:key+` honours optional `?versionId=`.
- [ ] `POST /:bucket` with `multipart/form-data` invokes `objects.postObject` (browser form upload).
- [ ] `POST /:bucket/:key+?restore` returns 200 OK (stub).
- [ ] `GET /:bucket/:key+?attributes` returns `<GetObjectAttributesOutput>`.
- [ ] `GET /:bucket/:key+?torrent` returns `NotImplemented`.

## Tasks
- [TASK-0332] Implement PutObject
- [TASK-0333] Implement GetObject
- [TASK-0334] Implement HeadObject
- [TASK-0335] Implement DeleteObject
- [TASK-0336] Implement CopyObject
- [TASK-0337] Implement PostObject (browser form upload)
- [TASK-0338] Implement RestoreObject stub
- [TASK-0339] Implement GetObjectAttributes
- [TASK-0340] Implement GetObjectTorrent NotImplemented

## Test plan
- [TEST-0115] Object CRUD e2e
- [TEST-0116] Object CRUD conformance (aws-cli, mc, s3cmd)

## Dependencies
- Blocked by: [STORY-0100], [STORY-0102], [STORY-0103], [STORY-0104], [STORY-0106], [EPIC-03], [EPIC-04]

## References
- `docs/WHITEPAPER.md` §2.8.3 (lines 2542–2563), §2.1.1 (lines 1155–1229)
- Interfaces consumed: `ObjectService` (EPIC-03), streaming pipe primitive (EPIC-04), `XmlInterceptor`, `SigV4Guard`
