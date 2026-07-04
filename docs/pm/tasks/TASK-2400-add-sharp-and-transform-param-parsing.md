---
id: TASK-2400
title: Add sharp dependency and transform-param parsing/validation
story: STORY-0800
status: backlog
type: implementation
size: M
---

## Description
Add the `sharp` dependency and a pure, self-contained parser that turns the GET
query string into a validated `TransformParams` value object (or a typed
rejection). This is the trust boundary for the whole feature: it bounds every
attacker-controlled dimension before any pixels are decoded, mirroring the
"validate at the edge" posture of `env.schema.ts` and the `nestjs-zod` DTOs used
in the admin module. It also owns the two gates that decide whether a request is
even a transform: the presence of transform params, and whether the source
content-type is an allow-listed raster image.

## Files to create / modify
- `libs/nestjs/package.json` — modify: add `"sharp": "^0.34.0"` to `dependencies`
  (native libvips prebuilds; note it in the standalone image build).
- `libs/nestjs/src/lib/s3/transforms/transform-params.ts` — new: the zod schema,
  `parseTransformParams`, `isTransformRequest`, `isTransformableContentType`, the
  format→MIME map, and the `TransformParams` type.
- `libs/nestjs/src/lib/s3/transforms/transform-params.spec.ts` — new: unit tests.

## Implementation notes
- Query grammar (all optional, but at least one of `w`/`h`/`format` required to be
  a transform request): `w`, `h` (ints), `fit` (`cover|contain|fill|inside|outside`,
  the sharp `fit` enum), `format` (`webp|jpeg|png|avif`), `q` (int quality).
- Schema (zod, `z.coerce` like `env.schema.ts`), bounds injected from config
  (TASK-2403) so tests can pass small caps:
  ```ts
  export type OutputFormat = 'webp' | 'jpeg' | 'png' | 'avif';
  export interface TransformParams {
    width?: number; height?: number;
    fit: 'cover' | 'contain' | 'fill' | 'inside' | 'outside';
    format?: OutputFormat; quality: number;
  }
  export const FORMAT_MIME: Record<OutputFormat, string> = {
    webp: 'image/webp', jpeg: 'image/jpeg', png: 'image/png', avif: 'image/avif',
  };
  export function transformSchema(maxDim: number) {
    return z.object({
      w: z.coerce.number().int().positive().max(maxDim).optional(),
      h: z.coerce.number().int().positive().max(maxDim).optional(),
      fit: z.enum(['cover','contain','fill','inside','outside']).default('cover'),
      format: z.enum(['webp','jpeg','png','avif']).optional(),
      q: z.coerce.number().int().min(1).max(100).default(80),
    });
  }
  ```
- `parseTransformParams(q, maxDim)` runs `safeParse`; on failure throw
  `InvalidArgumentError` (see `s3/errors/s3-error.ts`) → 400, never a 500. Reject
  unknown/oversized values here so the pipeline downstream can assume clean input.
- `isTransformRequest(q)` — true iff any of `w`/`h`/`format` present **and** none of
  the sub-resource flags (`tagging`/`acl`/`retention`/`legal-hold`/`attributes`/
  `uploadId`/`versionId`) are present, so a tagging/version request is never
  mistaken for a transform.
- `isTransformableContentType(ct)` — allow-list `image/jpeg`, `image/png`,
  `image/webp`, `image/avif`, `image/gif`, `image/tiff`. **Deliberately excludes**
  `image/svg+xml` (librsvg external-entity/XXE + active-content surface — mirrors
  `ACTIVE_CONTENT_TYPES` in `object.service.ts:53`) and every non-image type, so
  those pass through to the normal GET.
- Security/DoS: this file is the only place raw params become numbers; every bound
  (`maxDim`, format allow-list, `q` clamp) is enforced here, before decode.
- Edge cases: `w` only (height auto), `h` only, neither but `format` set (re-encode
  at native size), `q` default 80, `fit` default `cover`. Reject `w=0`, negative,
  non-numeric, `format=svg`, `format=gif` (not an output format).

## Acceptance criteria
- [ ] `parseTransformParams({ w:'200', h:'200', format:'webp', q:'80' }, 4096)` returns
      `{ width:200, height:200, fit:'cover', format:'webp', quality:80 }`.
- [ ] `w`/`h` over `maxDim`, `q` outside `1..100`, `format=svg`, and `w=abc` each throw
      `InvalidArgumentError` (mapped to 400), not a 500.
- [ ] `isTransformableContentType('image/svg+xml')` and `('text/html')` are `false`;
      `('image/jpeg')` is `true`.
- [ ] `isTransformRequest` is `false` when `?tagging`/`?versionId`/`?acl` present even
      alongside `w=`.
- [ ] `nx test nestjs --testPathPattern=transform-params.spec` passes.

## Test obligations
- Unit: covered by [TEST-0800] (param validation + content-type gate cases)
- E2E: covered by [TEST-0800] (400 on bad params via the real GET route)
- Conformance: N/A

## Dependencies
- Blocked by: [TASK-2403] (consumes the `maxTransformDimension` config bound; may be
  developed in parallel against a literal default and rewired)

## References
- `libs/nestjs/src/lib/common/config/env.schema.ts` (zod-at-the-edge pattern).
- `libs/nestjs/src/lib/domain/objects/object.service.ts:53` (`ACTIVE_CONTENT_TYPES`).
- `libs/nestjs/src/lib/s3/routing/operation-resolver.ts:113` (params keep op = `GetObject`).
- sharp resize/fit docs: https://sharp.pixelplumbing.com/api-resize
</content>
