---
id: TASK-3301
title: Add bounded text/code preview via a Range-limited fetch
story: STORY-1100
status: backlog
type: implementation
size: S
---

## Description
Add a text/code branch to `ObjectPreviewComponent` that renders the first slice of
a text object as read-only monospace. The fetch is bounded server-side by a `Range`
header so a multi-gigabyte log or CSV never streams into the browser, and a banner
tells the operator when the shown content is truncated.

## Files to create / modify
- `apps/openbucket-frontend/src/app/objects/object-preview.component.ts` — modify
  (text branch + `Range`-limited fetch + binary sniff + truncation banner)
- `apps/openbucket-frontend/src/app/objects/text-preview.util.ts` — new
  (byte→string decode + binary detection helpers, pure + unit-testable)
- `apps/openbucket-frontend/src/app/objects/object-preview.component.spec.ts` — modify

## Implementation notes
- Constant: `export const TEXT_PREVIEW_MAX_BYTES = 256 * 1024;` (256 KiB).
- Bounded fetch: request only the head of the object with a Range header —
  ```ts
  this.http.get(this.contentUrl(key), {
    responseType: 'arraybuffer',
    headers: { Range: `bytes=0-${TEXT_PREVIEW_MAX_BYTES - 1}`, observe: 'response' },
  });
  ```
  The admin content route already honours `Range` (`ObjectService.getObject`:
  `parseRange` → 206 + `Content-Range`). Treat a 206 (or a `Content-Range` whose
  total exceeds the returned length) as "truncated" and show the banner.
- Decode + binary sniff in `text-preview.util.ts`:
  ```ts
  export function looksBinary(bytes: Uint8Array): boolean; // NUL byte in first 8 KiB, or >10% non-printable
  export function decodeUtf8(bytes: Uint8Array): string;   // new TextDecoder('utf-8', { fatal: false })
  ```
  If `looksBinary` is true, do NOT render text — fall through to the binary fallback
  card (so a `.bin` mislabeled `text/plain` doesn't dump control chars).
- Render: `<pre class="max-h-96 overflow-auto ..."><code>{{ text() }}</code></pre>`
  (no syntax highlighting library in v1 — plain monospace; the extension→language
  hint from the classifier can select a CSS class for a future highlighter). Escape
  is automatic via Angular text interpolation; never use `[innerHTML]`.
- Classifier ([TASK-3302]) decides `kind === 'text'` from `contentType` starting
  with `text/`, or being one of the JSON/XML/JS/YAML/etc. `application/*` code types,
  or a known code file extension when `contentType` is a generic
  `application/octet-stream`.
- Security / DoS: the `Range` cap bounds transfer to ~256 KiB regardless of object
  size, so this is the only preview path safe to run on large objects; the
  whole-object cap check is skipped for text (Range makes it moot). No bytes are
  interpreted as markup — text is inert in a `<pre>`.

## Acceptance criteria
- [ ] A `text/plain` object > 256 KiB renders the first 256 KiB and shows a
  translated truncation banner (`objects.previewTruncated`).
- [ ] A binary blob mislabeled `text/plain` shows the binary fallback, not garbled
  text (asserted via `looksBinary`).
- [ ] The network request carries `Range: bytes=0-262143`.
- [ ] `nx test openbucket-frontend --test-file object-preview.component.spec.ts` passes,
  including `text-preview.util` cases.

## Test obligations
- Unit: covered by [TEST-1100] (`looksBinary`/`decodeUtf8`, truncation state)
- E2E: covered by [TEST-1100] (backend Range 206 returns first N bytes)
- Conformance: N/A

## Dependencies
- Blocked by: [TASK-3300], [TASK-3302]

## References
- `libs/nestjs/src/lib/domain/objects/object.service.ts` — `getObject` Range branch
  (`parseRange`, 206, `Content-Range`, `Accept-Ranges`), `RANGE_VERIFY_MAX_BYTES`.
- `libs/nestjs/src/lib/s3/object/range.ts` — `parseRange`.
