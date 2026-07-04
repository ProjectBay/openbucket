---
id: TASK-3304
title: Harden the admin content endpoint for preview
story: STORY-1100
status: backlog
type: infra
size: S
---

## Description
Audit and lightly harden the backend path that serves preview bytes
(`GET …/objects/*?content` → `ObjectService.getObject`) so the new preview feature
cannot become a data-exfiltration or DoS lever, and lock the behaviour in with an
integration test. No new route is added; the goal is to confirm and pin the existing
EPIC-08 posture and add a `Cache-Control` for previewed bytes.

## Files to create / modify
- `libs/nestjs/src/lib/admin/objects/objects-admin.controller.ts` — modify (set
  `Cache-Control: private, no-store` on the `?content` branch before streaming)
- `libs/nestjs/src/lib/admin/objects/objects-admin.controller.spec.ts` — modify/new
  (assert content branch behaviour)
- `libs/nestjs/test/objects-admin-content.e2e-spec.ts` — new (integration:
  Range 206, safe headers, HTML/SVG attachment-forcing)

## Implementation notes
- In the `get()` handler's `'content' in req.query` branch, before calling
  `this.objects.getObject(req, res, bucket, key)`, set
  `res.setHeader('Cache-Control', 'private, no-store')` so previewed object bytes are
  never persisted in a shared/browser cache (defense for multi-operator installs).
  Leave the `?download` disposition path untouched.
- Confirm (and assert, do not change) the existing guarantees:
  - The route is under `@Controller('api/admin/buckets/:name/objects')`, which is
    behind the global `JwtAuthGuard` — an unauthenticated `?content` request is 401.
  - `ObjectService.getObject` applies `applySafeObjectResponseHeaders`, so every
    preview response carries `Content-Security-Policy: default-src 'none'; sandbox`
    and `X-Content-Type-Options: nosniff`, and `text/html`/`application/xhtml+xml`/
    `image/svg+xml` are forced to `attachment; application/octet-stream`
    (`isActiveContentType`). The preview frontend relies on this — verify it holds.
  - `Range: bytes=0-262143` yields `206` with `Content-Range` and only the requested
    bytes (backs the [TASK-3301] text cap); an unsatisfiable range yields `416`.
- Key handling: the key is taken from the raw path tail (`rawTail`) and decoded
  exactly once (`decodeOnce`, §5.13) so a double-encoded `%252F` stays `%2F` — the
  preview client must `encodeURIComponent(key)` exactly once (it does). No change; add
  a test case for a slash-bearing key preview.
- DoS: no server-side image/PDF transcoding is introduced (v1 relies on the browser
  decoders), so there is no new CPU amplification vector; the only unbounded read is
  the whole-object stream, which is exactly today's download behaviour and is bounded
  on the client by the per-kind cap ([TASK-3302]) and the text Range cap.
- No `libs/api-client` regeneration is required: preview/download bytes are fetched
  with the raw `HttpClient`, not the generated `ObjectsAdminService`, and no
  OpenAPI-described route changes shape.

## Acceptance criteria
- [ ] `?content` responses include `Cache-Control: private, no-store`.
- [ ] Integration test asserts: 401 without JWT; `Range` → 206 + correct
  `Content-Range` + byte count; a `text/html` object served with `?content` comes
  back as `application/octet-stream` + `attachment` and CSP `default-src 'none'; sandbox`.
- [ ] `nx test nestjs` (unit) and the new e2e spec pass.

## Test obligations
- Unit: covered by [TEST-1100] (controller header assertions)
- E2E: covered by [TEST-1100] (content-endpoint integration spec)
- Conformance: N/A — admin-only route, not S3 surface

## Dependencies
- Blocked by: none

## References
- `libs/nestjs/src/lib/admin/objects/objects-admin.controller.ts` — `get()`
  (`?content`/`?download` branch ~294–310), `rawTail`, `decodeOnce`.
- `libs/nestjs/src/lib/domain/objects/object.service.ts` — `getObject`,
  `applySafeObjectResponseHeaders`, `isActiveContentType`.
- EPIC-08 authz: `libs/nestjs/src/lib/s3/authz/policy-authorization.guard.ts`,
  `operation-action.ts`; the global `JwtAuthGuard` wiring.
