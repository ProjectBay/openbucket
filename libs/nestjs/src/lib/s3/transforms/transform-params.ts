import { z } from 'zod';

import { InvalidArgumentError } from '../errors/s3-error';

/**
 * On-the-fly image transforms (STORY-0800). This module is the trust boundary
 * for the whole feature: it turns the attacker-controlled GET query string into
 * a validated {@link TransformParams} value object (or a typed 400), bounding
 * every dimension *before* any pixels are decoded — mirroring the
 * "validate at the edge" posture of `env.schema.ts` and the admin `nestjs-zod`
 * DTOs. It also owns the two gates that decide whether a request is even a
 * transform: the presence of transform params ({@link isTransformRequest}) and
 * whether the source content-type is an allow-listed raster image
 * ({@link isTransformableContentType}).
 */

/** Output formats sharp may re-encode to. Deliberately excludes gif/svg. */
export type OutputFormat = 'webp' | 'jpeg' | 'png' | 'avif';

/** A validated, fully-bounded transform request. */
export interface TransformParams {
  width?: number;
  height?: number;
  fit: 'cover' | 'contain' | 'fill' | 'inside' | 'outside';
  format?: OutputFormat;
  quality: number;
}

/** Output-format → response MIME type. */
export const FORMAT_MIME: Record<OutputFormat, string> = {
  webp: 'image/webp',
  jpeg: 'image/jpeg',
  png: 'image/png',
  avif: 'image/avif',
};

/**
 * Source content-types that may be decoded + re-encoded by sharp. **Excludes**
 * `image/svg+xml` (librsvg XXE / active-content surface — mirrors
 * `ACTIVE_CONTENT_TYPES` in `object.service.ts`) and every non-image type, so
 * those pass through to the normal, header-neutralized GET path untouched.
 */
const TRANSFORMABLE_CONTENT_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/avif',
  'image/gif',
  'image/tiff',
]);

/**
 * Sub-resource / variant query flags that mean a GET is NOT a transform even if
 * `w`/`h`/`format` happen to be present, so a tagging / versioned / ACL request
 * is never mistaken for one.
 */
const SUBRESOURCE_FLAGS = [
  'tagging',
  'acl',
  'retention',
  'legal-hold',
  'attributes',
  'uploadId',
  'versionId',
  'torrent',
] as const;

/**
 * Zod schema for the transform query grammar. Bounds are injected from config
 * (`maxDim` = `AppConfigService.maxTransformDimension`) so tests can pass small
 * caps. `z.coerce` mirrors `env.schema.ts` — raw query strings become numbers
 * here, and only here.
 */
export function transformSchema(maxDim: number) {
  return z.object({
    w: z.coerce.number().int().positive().max(maxDim).optional(),
    h: z.coerce.number().int().positive().max(maxDim).optional(),
    fit: z.enum(['cover', 'contain', 'fill', 'inside', 'outside']).default('cover'),
    format: z.enum(['webp', 'jpeg', 'png', 'avif']).optional(),
    q: z.coerce.number().int().min(1).max(100).default(80),
  });
}

/** True iff `contentType` (ignoring any `; charset=…`) is a transformable raster image. */
export function isTransformableContentType(contentType: string | undefined | null): boolean {
  if (!contentType) return false;
  return TRANSFORMABLE_CONTENT_TYPES.has(contentType.split(';', 1)[0].trim().toLowerCase());
}

/**
 * Gate 1: is this GET a transform request at all? True iff at least one of
 * `w`/`h`/`format` is present AND none of the sub-resource / version flags are —
 * so `?tagging`, `?versionId=…`, `?acl` (etc.) always fall through to their own
 * handlers even when a stray `w=` is tacked on.
 */
export function isTransformRequest(q: Record<string, unknown>): boolean {
  for (const flag of SUBRESOURCE_FLAGS) {
    if (flag in q && q[flag] !== undefined) return false;
  }
  return (
    (q['w'] !== undefined && q['w'] !== '') ||
    (q['h'] !== undefined && q['h'] !== '') ||
    (q['format'] !== undefined && q['format'] !== '')
  );
}

/**
 * Parse + validate the transform query into a {@link TransformParams}. This is
 * the only place raw params become numbers; every bound (`maxDim`, the format
 * allow-list, the `q` clamp) is enforced here, before any decode. On any schema
 * failure it throws {@link InvalidArgumentError} (→ 400), never a 500.
 */
export function parseTransformParams(
  q: Record<string, unknown>,
  maxDim: number,
): TransformParams {
  const result = transformSchema(maxDim).safeParse({
    w: q['w'],
    h: q['h'],
    fit: q['fit'],
    format: q['format'],
    q: q['q'],
  });
  if (!result.success) {
    const first = result.error.issues[0];
    const argName = first?.path.join('.') || undefined;
    throw new InvalidArgumentError(
      `Invalid transform parameter: ${first?.message ?? 'malformed request'}`,
      argName,
    );
  }
  const v = result.data;
  return {
    width: v.w,
    height: v.h,
    fit: v.fit,
    format: v.format,
    quality: v.q,
  };
}
