---
id: TASK-3302
title: Add a shared preview-kind classifier with per-kind size caps
story: STORY-1100
status: backlog
type: implementation
size: S
---

## Description
Create a single pure function that decides how (and whether) an object can be
previewed, from its content type, key/extension, and size. It returns the preview
kind and the applicable byte cap so both `ObjectPreviewComponent` and the row
"Preview" affordance ([TASK-3303]) share one decision instead of the two divergent
extension maps that exist today (`fileIcon` + `previewKindFor`).

## Files to create / modify
- `apps/openbucket-frontend/src/app/objects/preview-kind.ts` — new (classifier + caps)
- `apps/openbucket-frontend/src/app/objects/preview-kind.spec.ts` — new
- `apps/openbucket-frontend/src/app/objects/object-icon.ts` — new (extract `fileIcon`
  extension→lucide map from `object-browser.component.ts` so it is shared)
- `apps/openbucket-frontend/src/app/objects/object-browser.component.ts` — modify
  (import `fileIcon` from `object-icon.ts`; drop the local copy)
- `apps/openbucket-frontend/public/i18n/en.json` (and sibling locales) — modify
  (add `objects.previewTruncated`, `objects.previewUnsupported`,
  `objects.previewBinary`, `objects.previewError`; keep existing
  `objects.previewLoading` / `objects.previewTooLarge`)

## Implementation notes
- API sketch:
  ```ts
  export type PreviewKind = 'image' | 'pdf' | 'text' | 'video' | 'audio' | null;
  export interface PreviewDecision { kind: PreviewKind; capBytes: number; overCap: boolean; }
  export const PREVIEW_CAPS = {
    image: 25 * 1024 * 1024,   // 25 MiB — browser decodes whole image
    pdf:   50 * 1024 * 1024,   // 50 MiB — matches today's maxPreviewBytes
    text:  256 * 1024,         // fetched via Range, so this is the display cap
    video: 200 * 1024 * 1024,  // streamed with Range, high cap
    audio: 100 * 1024 * 1024,
  } as const;
  export function classifyPreview(contentType: string | undefined, key: string, size: number): PreviewDecision;
  ```
- Decision order: (1) content type — `image/*`→image (except `image/svg+xml`→null,
  it is served as an attachment by the server so it cannot render inline),
  `application/pdf`→pdf, `text/*`→text, JSON/XML/JS/YAML/CSV `application/*`→text,
  `video/*`→video, `audio/*`→audio. (2) If content type is generic
  (`application/octet-stream` / empty), fall back to the extension using the shared
  `object-icon` category map (code/text extensions → text; image extensions → image;
  etc.). (3) `overCap = kind !== 'text' && size > PREVIEW_CAPS[kind]`.
- Extract the existing `fileIcon(key)` map verbatim into `object-icon.ts` and export
  both `fileIcon(key): string` and a `categoryFor(ext): 'image'|'code'|'text'|...`
  used by the classifier, so the icon column and the classifier can never disagree.
- Edge cases: empty/undefined content type; content type with `; charset=utf-8`
  params (strip params, lower-case — mirror `isActiveContentType` on the server);
  keys with no extension; upper-case extensions.
- Security / DoS: `svg` maps to `null` (never inline) to align with the server's
  `ACTIVE_CONTENT_TYPES` neutralization; the caps bound how much a single preview can
  pull into memory for the non-Range kinds.

## Acceptance criteria
- [ ] `classifyPreview('image/svg+xml', 'x.svg', 10)` returns `kind: null`
  (no inline SVG execution).
- [ ] `classifyPreview('application/octet-stream', 'a.ts', 100)` returns `kind: 'text'`
  via the extension fallback.
- [ ] `classifyPreview('image/png', 'a.png', 30 * 1024 * 1024)` returns
  `overCap: true`.
- [ ] `fileIcon` is defined once (in `object-icon.ts`) and imported by the browser.
- [ ] `nx test openbucket-frontend --test-file preview-kind.spec.ts` passes.

## Test obligations
- Unit: covered by [TEST-1100] (classifier truth table + caps)
- E2E: N/A
- Conformance: N/A

## Dependencies
- Blocked by: none (foundational; unblocks [TASK-3300], [TASK-3301], [TASK-3303])

## References
- `apps/openbucket-frontend/src/app/objects/object-browser.component.ts` — `fileIcon`
  (~959–977), `previewKindFor` (~1175–1182).
- `libs/nestjs/src/lib/domain/objects/object.service.ts` — `isActiveContentType`,
  `ACTIVE_CONTENT_TYPES` (the SVG/HTML neutralization the classifier must mirror).
