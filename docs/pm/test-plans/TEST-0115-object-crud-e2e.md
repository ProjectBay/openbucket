---
id: TEST-0115
title: Object CRUD e2e
covers: [STORY-0109, TASK-0332, TASK-0333, TASK-0334, TASK-0335, TASK-0336, TASK-0337, TASK-0338, TASK-0339, TASK-0340]
status: done
level: e2e
---

## Goal
End-to-end verify object CRUD endpoints from §2.8.3.

## Setup
- Boot backend, sign with aws4. Use a 5 MB random payload for streaming sanity.

## Cases
1. `PUT /b/k` with 1 MB body → 200, ETag = MD5; `GET /b/k` → 200 with the same bytes; `HEAD /b/k` → headers only, no body; `DELETE /b/k` → 204; `GET /b/k` → 404 `<Code>NoSuchKey</Code>`.
2. `GET /b/k` with `Range: bytes=0-99` → 206 with `Content-Range`.
3. `GET /b/k` with `If-None-Match` matching ETag → 304 no body.
4. `PUT /b/k2` with `x-amz-copy-source: /b/k` → 200 `<CopyObjectResult>`.
5. `POST /b` `multipart/form-data` with fields `key`, `file` → 204 or 303.
6. `POST /b/k?restore` → 200.
7. `GET /b/k?attributes` with `x-amz-object-attributes: ETag,ObjectSize` → 200 `<GetObjectAttributesOutput>`.
8. `GET /b/k?torrent` → 501 `<Code>NotImplemented</Code>`.

## Tooling
- Framework: jest + supertest + aws4
- Runner: `nx e2e backend-e2e --testPathPattern=object-crud`

## Pass criteria
- [ ] All eight cases pass.

## References
- `docs/WHITEPAPER.md` §2.8.3 (lines 2542–2563)
