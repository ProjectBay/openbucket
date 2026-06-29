---
id: TEST-0424
title: ObjectUploadComponent unit spec (encoding + progress)
covers: [STORY-0418, TASK-1256]
status: backlog
level: unit
---

## Goal
Verify the single-encoding rule and progress-event handling in `ObjectUploadComponent`. Component scope only — drag/drop UI styling is out of scope.

## Setup
- `HttpTestingController`.
- Provide a stub `File` (or `Blob`) with `name = 'file.txt'`, `type = 'text/plain'`.

## Cases
1. Upload with `prefix = ''` and `file.name = 'a.txt'` → PUT URL is `/api/admin/buckets/{bucket}/objects/a.txt`.
2. Upload with `prefix = 'folder/'` and `file.name = 'sub file.txt'` → PUT URL is `/api/admin/buckets/{bucket}/objects/folder%2Fsub%20file.txt` (`encodeURIComponent` applied **exactly once**).
3. Upload with `prefix = 'a/b/'` and `file.name = 'c.txt'` → URL contains `a%2Fb%2Fc.txt` (slashes encoded once; no `%252F`).
4. `Content-Type` header is the file's type when present (`'text/plain'`), otherwise `'application/octet-stream'`.
5. Request is observed with `reportProgress: true, observe: 'events'`.
6. `uploads` signal contains a row with `progress: 0` immediately after start; updates progress when `UploadProgress` events arrive; emits `uploaded` event with the key on completion.

## Tooling
- Framework: jest + `HttpTestingController`
- Runner: `nx test frontend --testPathPattern=object-upload.component.spec.ts`

## Pass criteria
- [ ] All six cases pass.

## References
- `docs/WHITEPAPER.md` §5.14 (lines 8183–8269)
