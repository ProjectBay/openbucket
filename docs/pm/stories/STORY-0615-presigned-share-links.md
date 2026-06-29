---
id: STORY-0615
title: Presigned share links
epic: EPIC-07
status: done
size: S
risk: medium
---

## User story
As an operator, I want to generate a time-limited share URL for an object from its row menu, so I can hand someone a download link without exposing credentials.

## Description
SigV4 presign *verification* exists in the S3 layer but there is no *generator* and no UI. STORY-0612 adds the admin presign endpoint; this story adds the row-menu UI to request and copy a link.

## Acceptance criteria
- [ ] The object row `HlmDropdownMenu` (STORY-0604) gains "Copy share link" with an expiry `hlm-select` (1h/24h/7d, capped at the backend `MAX_EXPIRES`).
- [ ] Requesting a link calls the presign endpoint and copies the returned URL via the shared copy-button + toast showing the expiry.
- [ ] The generated URL verifies through the existing SigV4 verifier (covered by the endpoint's test).

## Tasks
- [TASK-1878] Add "Copy share link" + expiry `hlm-select` to the object row menu.
- [TASK-1879] Call the presign endpoint; copy URL via copy-button + `notify` (expiry shown).
- [TASK-1880] Handle errors (expiry too long, object missing) via toast.
- [TASK-1881] i18n keys.

## Test plan
- [TEST-0615] Manual/e2e: generate a link, fetch it succeeds before expiry and 403s after; copy feedback; expiry options capped.

## Dependencies
- Blocks: _none_
- Blocked by: [STORY-0604], [STORY-0612]

## References
- UX review 2026-06-22 (power-user G; feature-gap table).
- `apps/openbucket-backend/src/s3/sigv4/presigned.ts`, `libs/api-client` (presign endpoint), `apps/openbucket-frontend/src/app/objects/object-browser.component.ts`.
