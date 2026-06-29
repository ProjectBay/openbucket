---
id: TASK-1879
title: Call the presign endpoint and copy the URL via copy-button + notify
story: STORY-0615
status: done
type: implementation
size: S
---

## Description
Wire the "Copy share link" action (TASK-1878) to the admin presign endpoint (STORY-0612), copy the returned URL to the clipboard via the shared copy mechanism, and toast the success with the chosen expiry. The returned URL is a SigV4 query-signed URL valid until `expiresAt`.

## Files to create / modify
- `apps/openbucket-frontend/src/app/objects/share-link.component.ts` — modify (call the endpoint; copy + toast)
- `apps/openbucket-frontend/src/app/objects/object-browser.component.ts` — modify only if the request handler lives on the parent

## Implementation notes
- Call `ObjectsAdminService.presignObject(name, path, body, ...)` (added by STORY-0612 / TASK-1863), with `body = { expiresIn }` (seconds, from TASK-1878). The response is `PresignedUrlDto { url: string; expiresAt: string }` (`libs/api-client`). Use `firstValueFrom(...)` to match the existing `getObject`/`listObjects` call style in `object-browser.component.ts`.
- Copy the returned `url` to the clipboard. Reuse the shared `CopyButtonComponent` (TASK-1802) where the URL is surfaced, or call its underlying `navigator.clipboard.writeText(url)` path directly from the handler; on success fire `notify.success(...)` (TASK-1800) showing the human expiry (e.g. "Link copied — expires in 24 hours" / "expires {{ expiresAt | date }}").
- Wrap the request in `notify.promise(presign$, { loading, success, error })` so the toast transitions loading→success/error while the request is in flight.
- Do not log or persist the URL; it is single-use share material.

## Acceptance criteria
- [ ] `nx build openbucket-frontend` and `nx lint openbucket-frontend` pass.
- [ ] Triggering "Copy share link" calls `presignObject` with the chosen `expiresIn`, copies the returned `url` to the clipboard, and shows a success toast naming the expiry.
- [ ] The toast transitions loading→success/error via `notify.promise`.
- [ ] The copied URL is the exact `PresignedUrlDto.url` returned by the backend.

## Test obligations
- Unit: covered by [TEST-0615] (presignObject called with expiresIn; clipboard receives url; notify fires).
- E2E: covered by [TEST-0615] (manual/e2e: fetch the copied link succeeds before expiry).
- Conformance: N/A.

## Dependencies
- Blocked by: [TASK-1878], [STORY-0604], [STORY-0612]

## References
- UX review 2026-06-22 (power-user G — hand someone a download link without credentials).
- `libs/api-client/src/lib/api/objects-admin.service.ts` (`presignObject`, STORY-0612), `PresignedUrlDto` model, `apps/openbucket-backend/src/s3/sigv4/presigned.ts`.
- Interfaces consumed: `CopyButtonComponent` (TASK-1802), `notify` (TASK-1800), presign endpoint (STORY-0612).
