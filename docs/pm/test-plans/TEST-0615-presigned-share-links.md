---
id: TEST-0615
title: Presigned share links
covers: [STORY-0615, TASK-1878, TASK-1879, TASK-1880, TASK-1881]
status: done
level: e2e
---

## Goal
Verify an operator can generate a time-limited share URL from an object's row menu: the expiry options are capped, the presign endpoint is called, the returned URL is copied with feedback, the URL fetches successfully before expiry and 403s after, and errors surface as toasts.

## Setup
- Frontend on Node 23 (`nx serve openbucket-frontend`) against a booted backend on Node 20. Frontend unit harness is `jest-preset-angular`; if not wired, treat unit cases as build-verified and run behavioral cases manually.
- `@openbucket/api-client` regenerated with the STORY-0612 presign endpoint (`presignObject` → `PresignedUrlDto`).
- A bucket with at least one object; ability to fetch the generated URL with a plain HTTP client (curl / fetch) that does NOT send admin credentials, to prove the SigV4 query signature alone authorizes it.

## Cases
1. Given the object row menu, when opened, then "Copy share link" appears with a 1h/24h/7d expiry select and no option exceeds `MAX_EXPIRES`.
2. Given an expiry is selected and the action triggered, when the presign request succeeds, then `presignObject` is called with the chosen `expiresIn`, the returned `url` is copied to the clipboard, and a success toast names the expiry (loading→success via `notify.promise`).
3. Given the copied URL, when fetched with no admin credentials before expiry, then the object downloads (200); the same URL after expiry returns 403 (verified by the SigV4 verifier).
4. Given an expiry exceeding `MAX_EXPIRES` (forced server-side), when requested, then a "Expiry too long" error toast appears; given a missing object, then "Object not found"; given a network error, then a generic error toast.
5. Given the locale is `de`, when the menu + toasts render, then all share-link strings are German with no hardcoded English.

## Tooling
- Framework: jest (`@testing-library/angular` optional) for unit; curl / `@aws-sdk` or plain fetch for the URL-validity case; manual for the menu/clipboard checks.
- Runner: `nx test openbucket-frontend --testPathPatterns=objects` (if wired); `nx build openbucket-frontend` + `nx lint openbucket-frontend` as the always-green CLI anchors.

## Pass criteria
- [ ] `nx build openbucket-frontend` and `nx lint openbucket-frontend` pass (Node 23).
- [ ] Cases 1–5 verified (unit where wired; otherwise manual/e2e).
- [ ] The generated URL verifies through the existing SigV4 verifier (covered by the STORY-0612 endpoint's own test): valid before expiry, 403 after.

## References
- UX review 2026-06-22 (power-user G; feature-gap table).
- STORY-0615 and TASK-1878..1881; presign endpoint from STORY-0612; `apps/openbucket-backend/src/s3/sigv4/presigned.ts`.
