---
id: TASK-2110
title: Enable a Content-Security-Policy and force safe object-response headers on S3 GET/HEAD
story: STORY-0701
status: ready
type: implementation
size: M
---

## Description
Remediates audit finding [2] (HIGH, CWE-79 stored XSS). CSP is globally disabled and the raw S3 read path serves an attacker-controlled `Content-Type` inline with no `Content-Disposition`, so an object stored as `text/html` renders and executes on the admin/app origin. Injected script can then hit the same-origin `@Public` `POST /api/admin/auth/refresh` oracle, read the returned admin access token, and take over the admin API. This task neutralizes active content on every S3 object read and restores a restrictive CSP for the admin surface.

## Files to create / modify
- `apps/openbucket-backend/src/main.ts` — modify. Replace `helmet({ contentSecurityPolicy: false })` (line 42) with a helmet config that emits a restrictive default policy for the admin SPA/API (e.g. `default-src 'self'`), instead of disabling CSP entirely.
- `libs/nestjs/src/lib/domain/objects/object.service.ts` — modify. In `getObject` (around the header block at line 432) and `headObject` (line 521), set the inline-neutralization headers before the first body byte; optionally normalize dangerous stored `Content-Type` values on read.
- `libs/nestjs/src/lib/admin/objects/objects-admin.controller.ts` — modify. Ensure the `?content` preview branch (lines 298–309), which reuses `getObject`, also carries the neutralization headers (it currently only forces `Content-Disposition` on the `?download` branch at line 304).

## Implementation notes
- CWE-79 (Improper Neutralization of Input During Web Page Generation — Stored XSS).
- Root cause 1: `apps/openbucket-backend/src/main.ts:42` — `app.use(helmet({ contentSecurityPolicy: false }));` emits **no** CSP header on any response. Re-enable a restrictive policy (helmet's `contentSecurityPolicy` with directives such as `default-src 'self'`) so the admin SPA/API are covered; keep the existing global `X-Content-Type-Options: nosniff`.
- Root cause 2: `object.service.ts` `getObject` sets `res.setHeader('Content-Type', obj.contentType)` (line 432) and `headObject` the same at line 521, with **no** `Content-Disposition` and no per-response CSP. `obj.contentType` is stored verbatim from the PUT request header (`writer.put({ ... contentType })` path). `nosniff` does not stop a genuinely-declared `text/html` body from executing.
- Fix (single-origin hardening, per the audit fix note): on the raw S3 `GET`/`HEAD` responses set, before any body byte:
  ```ts
  res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Disposition', 'attachment');
  ```
  and/or override active `Content-Type` values (`text/html`, `image/svg+xml`, `application/xhtml+xml`) to a non-rendering type such as `application/octet-stream`. These headers must be set in the same pre-body header block (Node throws if set after the first byte — see the existing comment "Headers must precede the first body byte").
- The admin download endpoint already forces `Content-Disposition: attachment` for `?download` (`objects-admin.controller.ts:304`), but the `?content` inline-preview branch (lines 298–309) delegates straight to `getObject` and serves attacker `Content-Type` inline; hardening `getObject` itself fixes both call sites in one place (preferred), so verify the preview branch inherits the neutralization headers.
- Do **not** rely on this task to isolate the S3 data plane from the admin origin — the durable structural fix (separate host/port) is out of scope here; this closes the reachable stored-XSS primitive on the shipped single-origin deployment.
- Interaction: the `/api/admin/auth/refresh` token oracle is reachable only because [STORY-0700]'s admin-auth path is the same origin; land [TASK-2100] first.

## Acceptance criteria
- [ ] A `GET`/`HEAD` on an object stored with `Content-Type: text/html` returns `Content-Disposition: attachment`, `Content-Security-Policy: default-src 'none'; sandbox`, and `X-Content-Type-Options: nosniff`.
- [ ] The response either carries `Content-Disposition: attachment` or a non-rendering `Content-Type`, such that a browser does not execute the body inline.
- [ ] `main.ts` no longer sets `contentSecurityPolicy: false`; the admin SPA/API responses carry a `Content-Security-Policy` header with `default-src 'self'`.
- [ ] The admin `?content` preview branch response carries the same neutralization headers.
- [ ] `nx test nestjs --testPathPattern=object.service` (or the equivalent GET/HEAD e2e) asserts the headers above.

## Test obligations
- Unit: covered by [TEST-0701] (header-assertion cases for `getObject`/`headObject` and the CSP config).
- E2E: covered by [TEST-0701] (a stored `text/html` object served as an inert attachment; admin `?content` preview neutralized).
- Conformance: N/A — hardening headers are additive and do not change S3 body semantics.

## Dependencies
- Blocked by: [STORY-0700] ([TASK-2100] must land first — the XSS payoff drives the same-origin admin `/refresh` oracle).

## References
- White-box security audit, 2026-07-04 — finding [2] (HIGH, CWE-79).
- `apps/openbucket-backend/src/main.ts:42`; `libs/nestjs/src/lib/domain/objects/object.service.ts:432,521`; `libs/nestjs/src/lib/admin/objects/objects-admin.controller.ts:298-309`.
