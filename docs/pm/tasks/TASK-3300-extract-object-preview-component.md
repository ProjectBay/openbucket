---
id: TASK-3300
title: Extract a sandboxed, signals-based ObjectPreviewComponent
story: STORY-1100
status: backlog
type: implementation
size: M
---

## Description
Move the inline preview logic out of `ObjectBrowserComponent` into a dedicated
standalone `ObjectPreviewComponent` that takes a bucket + `ObjectMetaDto` input and
renders image / PDF (plus the existing video / audio) from an authenticated blob.
Harden the PDF path with an `<iframe sandbox>` and own the blob-URL lifecycle so
there is one place responsible for revoking object URLs. The component renders a
fallback card (not a blank panel) whenever the object is not previewable.

## Files to create / modify
- `apps/openbucket-frontend/src/app/objects/object-preview.component.ts` — new
- `apps/openbucket-frontend/src/app/objects/object-preview.component.spec.ts` — new
- `apps/openbucket-frontend/src/app/objects/object-browser.component.ts` — modify
  (remove `loadPreview`, `previewKindFor`, `clearPreview`, the `previewUrl`/
  `previewPdf`/`previewKind`/`previewTooLarge`/`previewLoading` signals, `previewRaw`,
  `maxPreviewBytes`, and the inline `@switch (previewKind())` markup; render
  `<ob-object-preview [bucket]="bucket()" [meta]="selected()!" />` in the details tab)

## Implementation notes
- Signals API sketch:
  ```ts
  @Component({ standalone: true, selector: 'ob-object-preview',
    changeDetection: ChangeDetectionStrategy.OnPush, /* imports: NgIcon, HlmButton, ByteSizePipe, TranslateModule */ })
  export class ObjectPreviewComponent {
    readonly bucket = input.required<string>();
    readonly meta = input.required<ObjectMetaDto>();
    private readonly http = inject(HttpClient);
    private readonly sanitizer = inject(DomSanitizer);
    private readonly destroyRef = inject(DestroyRef);
    readonly state = signal<'loading' | 'ready' | 'fallback' | 'error'>('loading');
    readonly imageUrl = signal<SafeUrl | null>(null);
    readonly pdfUrl = signal<SafeResourceUrl | null>(null);
    private objectUrl: string | null = null; // revoked in effect cleanup + destroyRef
  }
  ```
- Drive loading from an `effect()` keyed on `meta()`; on every change first revoke
  the previous `objectUrl` (fixes the current leak where switching objects abandons
  the blob URL), then classify + fetch. Register `destroyRef.onDestroy(() => revoke())`.
- Fetch bytes exactly as today — raw `HttpClient.get(url, { responseType: 'blob' })`
  against `/api/admin/buckets/<bucket>/objects/<encodeURIComponent(key)>?content`
  (JWT is attached by the app's HTTP interceptor). Keep `encodeURIComponent` applied
  once; the controller decodes once (`decodeOnce`).
- PDF hardening: render `<iframe [src]="pdfUrl()" sandbox class="h-96 w-full rounded border" title="PDF preview">`.
  The `sandbox` attribute with NO tokens blocks scripts, forms, popups, and
  same-origin, so a malicious PDF cannot script the admin origin. This is defense in
  depth on top of the server CSP; keep `bypassSecurityTrustResourceUrl` (required for
  a blob: URL in an iframe) but never introduce `bypassSecurityTrustHtml`.
- Image path: `<img [src]="imageUrl()">` from `bypassSecurityTrustUrl(blobUrl)`.
  Note SVG will NOT render inline — the server forces `image/svg+xml` to
  `attachment; application/octet-stream` (`isActiveContentType`), so SVG correctly
  falls through to the fallback card rather than executing.
- Fallback card: file icon (reuse the `fileIcon` extension map — extract it to
  `object-icon.ts` so both components share it), size via `ByteSizePipe`, content
  type, and an `hlmBtn` Download that reuses the browser's `?download` route.
- Keep the video/audio branches (`<video controls>` / `<audio controls>`) so no
  existing capability is dropped, but they share the same cap + fallback flow.
- Security / DoS: the per-kind cap (from [TASK-3302]) is checked against
  `meta().size` BEFORE any fetch; do not fetch bytes for over-cap objects. All reads
  stay on the guarded admin route so the [STORY-0700] authz / `applySafeObjectResponseHeaders`
  posture is unchanged.

## Acceptance criteria
- [ ] `ObjectBrowserComponent` no longer references `previewUrl`/`previewPdf`/
  `previewKind`/`previewRaw`/`maxPreviewBytes`; `grep` finds preview logic only in
  `object-preview.component.ts`.
- [ ] PDF iframe carries a `sandbox` attribute with no `allow-*` tokens.
- [ ] Switching the sheet from object A to object B revokes A's object URL
  (asserted in the spec via a `URL.revokeObjectURL` spy).
- [ ] `nx test openbucket-frontend --test-file object-preview.component.spec.ts` passes.

## Test obligations
- Unit: covered by [TEST-1100] (component render + revoke)
- E2E: covered by [TEST-1100] (manual: open sheet, preview renders)
- Conformance: N/A

## Dependencies
- Blocked by: [TASK-3302] (classifier + caps)

## References
- `apps/openbucket-frontend/src/app/objects/object-browser.component.ts` lines
  ~861–867 (preview signals), ~1147–1182 (`loadPreview`/`previewKindFor`),
  ~1401–1411 (`clearPreview`), ~959–977 (`fileIcon`).
- `libs/nestjs/src/lib/domain/objects/object.service.ts` — `applySafeObjectResponseHeaders`,
  `isActiveContentType`, `ACTIVE_CONTENT_TYPES`.
