---
id: STORY-1100
title: Object preview (image / PDF / text)
epic: EPIC-12
status: backlog
size: M
risk: low
---

## User story
As an operator browsing a bucket, I want to preview an object's contents — image,
PDF, or text/code — inline in the console without downloading it, so that I can
identify and verify objects quickly and safely.

## Description
The object browser already fetches image/pdf/video/audio blobs inline
(`ObjectBrowserComponent.loadPreview`), but the logic is inlined in a 1400-line
component, has no text/code path, no unsafe-content guard beyond a single 50 MiB
byte cap, and renders PDFs through `DomSanitizer.bypassSecurityTrustResourceUrl`
on an un-sandboxed `<iframe>`. This Story extracts a dedicated, signals-based
`ObjectPreviewComponent`, adds a bounded text/code renderer (first N bytes via a
`Range` request), a shared preview-kind classifier with per-kind size caps, a
sandboxed PDF frame, and clear fallbacks for binary / too-large / unsupported
objects. All bytes continue to flow through the existing authenticated
`GET …/objects/*?content` route so the EPIC-08 CSP + `nosniff` neutralization
([`applySafeObjectResponseHeaders`]) is preserved. It produces a reusable preview
widget wired into both the detail sheet and a per-row "Preview" action.

## Acceptance criteria
- [ ] A new standalone `ObjectPreviewComponent` renders image, PDF, and text/code
  previews from an authenticated blob fetched via `…/objects/<key>?content`; the
  old inline preview markup + logic is removed from `ObjectBrowserComponent`.
- [ ] Text/code objects render as read-only monospace with a bounded fetch: at most
  `TEXT_PREVIEW_MAX_BYTES` (256 KiB) are requested via a `Range: bytes=0-262143`
  header, with a visible "truncated" banner when the object is larger.
- [ ] PDF previews render in an `<iframe sandbox>` (no `allow-scripts`,
  no `allow-same-origin`); no code path passes attacker-controlled bytes to
  `bypassSecurityTrustHtml`.
- [ ] Preview kind is decided by a shared pure classifier (contentType first, file
  extension as a hint) with a per-kind byte cap; objects over the cap, binary
  objects, and unsupported types show a fallback card with size + a Download button
  instead of attempting to render.
- [ ] A "Preview" action is available from the browser row menu and opens the detail
  sheet focused on the preview, in addition to the existing details flow.
- [ ] Object-URL blobs are revoked on close/reload (no leak); preview errors are
  caught and surface a non-blocking fallback, never a blank panel.
- [ ] `nx test openbucket-frontend` covers the classifier and the too-large / binary
  fallback; the backend Range + safe-header behaviour is covered by [TEST-1100].

## Tasks
- [TASK-3300] Extract a sandboxed, signals-based ObjectPreviewComponent (image/PDF + fallback)
- [TASK-3301] Add bounded text/code preview via a Range-limited fetch
- [TASK-3302] Add a shared preview-kind classifier with per-kind size caps
- [TASK-3303] Wire a per-row Preview action and detail-sheet preview tab
- [TASK-3304] Harden the admin content endpoint for preview (Range cap, no-store, header audit)

## Test plan
- [TEST-1100] Object preview — classifier, fallbacks, Range-bounded text fetch, and safe headers

## Dependencies
- Blocks: —
- Blocked by: none. Reuses the EPIC-08 authz posture: admin content reads go
  through the global `JwtAuthGuard` and `ObjectService.getObject`, which applies
  `applySafeObjectResponseHeaders` (CSP `default-src 'none'; sandbox` + `nosniff`,
  attachment-forcing for `text/html`/`image/svg+xml`) — this Story must not regress
  it. Builds on the existing browser preview from [STORY-0604].

## References
- `apps/openbucket-frontend/src/app/objects/object-browser.component.ts`
  (`loadPreview`, `previewKindFor`, `contentUrl`, `clearPreview`, the
  `previewUrl`/`previewPdf`/`previewKind`/`previewTooLarge`/`previewLoading` signals,
  `maxPreviewBytes = 50 * 1024 * 1024`, `fileIcon`).
- `libs/nestjs/src/lib/admin/objects/objects-admin.controller.ts` — `get()` handler,
  the `?content` / `?download` branch, `rawTail`, `decodeOnce`.
- `libs/nestjs/src/lib/domain/objects/object.service.ts` — `getObject` (Range/206,
  `Accept-Ranges`), `head`, `applySafeObjectResponseHeaders`, `isActiveContentType`,
  `ACTIVE_CONTENT_TYPES`, `RANGE_VERIFY_MAX_BYTES`, `parseRange`.
- EPIC-08 authz: `libs/nestjs/src/lib/s3/authz/{policy-evaluator,operation-action,policy-authorization.guard}.ts`;
  `libs/nestjs/src/lib/storage/key-codec.ts`.
- `libs/api-client/src/lib/api/objects-admin.service.ts` (`getObject` — HEAD metadata).
- New dev deps: none required. (No `sharp` — previews reuse the browser's native
  `<img>`/`<iframe>` decoders on the raw blob; no server-side thumbnailing in v1.)
