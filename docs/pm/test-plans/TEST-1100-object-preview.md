---
id: TEST-1100
title: Object preview — classifier, fallbacks, Range-bounded text fetch, and safe headers
covers: [STORY-1100, TASK-3300, TASK-3301, TASK-3302, TASK-3303, TASK-3304]
status: backlog
level: integration
---

## Goal
Verify that the console previews images, PDFs, and text/code inline without a full
download; that it fails safe (fallback card, revoked blobs, no active-content
execution); that text previews are bounded by a `Range` request; and that the
backend content endpoint preserves the EPIC-08 authz + CSP/`nosniff` posture.

## Setup
- Frontend unit specs: `nx test openbucket-frontend` (Jest + Angular TestBed).
  Mock `HttpClient` with `provideHttpClientTesting`; spy on
  `URL.createObjectURL` / `URL.revokeObjectURL`.
- Backend integration: `nx test nestjs` + a new `objects-admin-content.e2e-spec.ts`
  bootstrapping the Nest app with a temp libsql DB and a temp FS blob root; seed one
  bucket with fixtures: `pic.png` (`image/png`), `doc.pdf` (`application/pdf`),
  `big.log` (`text/plain`, > 256 KiB), `page.html` (`text/html`), `vec.svg`
  (`image/svg+xml`), `deep/a b/keys.txt` (slash + space key). Obtain a JWT via the
  admin login route for authenticated calls.

## Cases

### Classifier — [TASK-3302]
1. Given `('image/png','a.png',1_000)` → `{ kind: 'image', overCap: false }`.
2. Given `('image/png','a.png',30*1024*1024)` → `overCap: true` (cap 25 MiB).
3. Given `('image/svg+xml','a.svg',10)` → `kind: null` (SVG never inlined).
4. Given `('application/pdf','a.pdf',10)` → `kind: 'pdf'`.
5. Given `('text/plain; charset=utf-8','a.txt',10)` → `kind: 'text'` (params stripped).
6. Given `('application/octet-stream','a.ts',10)` → `kind: 'text'` (extension fallback).
7. Given `('application/octet-stream','a.bin',10)` → `kind: null` (fallback card).
8. `fileIcon` is imported from `object-icon.ts` and returns `lucideImage` for `x.png`,
   `lucideFileCode` for `x.ts` — one map, no divergence with the classifier.

### Text util — [TASK-3301]
9. `looksBinary(Uint8Array([...,0x00,...]))` (NUL in first 8 KiB) → `true`.
10. `looksBinary(utf8Bytes('hello\nworld'))` → `false`; `decodeUtf8` round-trips it.

### Preview component — [TASK-3300], [TASK-3301], [TASK-3303]
11. Given an `image/png` meta under cap, the component fetches
    `…/objects/pic.png?content` as a blob and renders an `<img>` with
    `[alt]="meta.key"`.
12. Given `application/pdf`, it renders an `<iframe>` whose `sandbox` attribute is
    present and has NO `allow-scripts` / `allow-same-origin` token.
13. Given a `text/plain` object, the HTTP request carries
    `Range: bytes=0-262143`; a `206`/`Content-Range: bytes 0-262143/500000` response
    renders `<pre>` content and shows `objects.previewTruncated`.
14. Given `meta.size` over the per-kind cap, NO byte fetch is issued and the fallback
    card (icon + size + Download) renders (`state() === 'fallback'`).
15. Switching the `meta` input from `pic.png` to `doc.pdf` calls
    `URL.revokeObjectURL` with the first object URL (no leak); destroying the
    component revokes the current one.
16. A failed content fetch (500) sets `state() === 'error'`/`'fallback'` and never
    leaves a blank panel or throws.
17. The browser row `HlmDropdownMenu` contains a "Preview" item that invokes
    `openObject` and opens the detail sheet.

### Content endpoint — [TASK-3304]
18. `GET /api/admin/buckets/b/objects/pic.png?content` without a JWT → `401`.
19. Authenticated `?content` on `pic.png` → `200`, `Content-Type: image/png`,
    `Cache-Control: private, no-store`, `X-Content-Type-Options: nosniff`,
    `Content-Security-Policy: default-src 'none'; sandbox`.
20. `?content` with `Range: bytes=0-9` on `big.log` → `206`, `Content-Range:
    bytes 0-9/<size>`, body length 10, `Accept-Ranges: bytes`.
21. `?content` on `page.html` → body served as `application/octet-stream` with
    `Content-Disposition: attachment` (active-content neutralized); same for
    `vec.svg`.
22. `?content` on the slash+space key `deep/a b/keys.txt`
    (client sends `encodeURIComponent` once) → `200` and correct bytes (single decode).
23. An unsatisfiable `Range: bytes=999999999-` on `pic.png` → `416` with
    `Content-Range: bytes */<size>`.

## Tooling
- Framework: jest + @angular/core/testing (frontend); jest + supertest (backend e2e).
- Runner: `nx test openbucket-frontend`, `nx test nestjs`,
  `nx e2e nestjs` (or the project's configured integration target).

## Pass criteria
- [ ] All classifier + text-util cases (1–10) pass.
- [ ] Component cases (11–17) pass, including the revoke-on-switch assertion.
- [ ] Content-endpoint cases (18–23) pass, proving authz + CSP/`nosniff` +
  attachment-forcing + Range are intact and `Cache-Control: no-store` is added.

## References
- `apps/openbucket-frontend/src/app/objects/{object-preview.component,preview-kind,text-preview.util,object-icon}.ts`
- `libs/nestjs/src/lib/admin/objects/objects-admin.controller.ts`
- `libs/nestjs/src/lib/domain/objects/object.service.ts` — `getObject`,
  `applySafeObjectResponseHeaders`, `isActiveContentType`, `parseRange`.
