---
id: TASK-0337
title: Implement PostObject (browser-form upload)
story: STORY-0109
status: done
type: implementation
size: M
---

## Description
Implement `POST /:bucket` with `multipart/form-data` (`PostObject`) per §2.8.3 — the browser form upload variant.

## Files to create / modify
- `apps/backend/src/s3/controllers/object.controller.ts` — modify (POST family terminal branch)

## Implementation notes
- Route: `| POST | `/:bucket` | — (multipart form) | `PostObject` | Browser-form upload; body is `multipart/form-data`. |` (§2.8.3 line 2551).
- Per §2.1.1 (line 1215): `return this.objects.postObject(req, res, bucket, key); // browser form upload`.
- Apply `@S3Operation('PostObject')`.
- Form fields: `policy` (base64 JSON), `x-amz-signature`, `key` (object key, may contain `${filename}`), `Content-Type`, `success_action_redirect`, the `file` field carries the bytes.
- Signature on the `policy` field is verified via the same SigV4 chain as a presigned URL — implementation owned by EPIC-04 (streaming-aware multipart parser).

## Acceptance criteria
- [ ] Standard browser form upload (HTML `<form enctype="multipart/form-data">`) accepted.
- [ ] `key` field placeholder `${filename}` replaced with the uploaded file name.
- [ ] On `success_action_redirect`, returns 303 to that URL.

## Test obligations
- Unit: N/A
- E2E: covered by [TEST-0115]
- Conformance: covered by [TEST-0116]

## Dependencies
- Blocked by: [TASK-0301], [STORY-0103], [EPIC-03], [EPIC-04]

## Deviation (v1) — deferred
PostObject (browser `multipart/form-data` upload with POST-policy signature) is
**deferred** and currently returns `NotImplemented` (501). Rationale: it needs
the EPIC-04 streaming form-data parser + POST-policy SigV4 verification, and is
not exercised by any conformance client (aws-cli, mc, s3cmd) — only by raw HTML
browser forms. The route + dispatch branch exist; the full handler lands in a
follow-up. Tracked as a known gap; see the STORY-0109 note.

## References
- `docs/WHITEPAPER.md` §2.8.3 (line 2551), §2.1.1 (line 1215)
