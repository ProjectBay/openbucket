import { randomUUID } from 'node:crypto';

import { isActiveContentType } from './domain/objects/object.service';

/**
 * Declarative upload validation + sanitized key strategies (STORY-0803,
 * TASK-2432). Pure, side-effect-free helpers plus a typed error that
 * `OpenBucketService.uploadFrom` (TASK-2433) composes. The two load-bearing
 * security gates live here:
 *
 *  1. sniffed-over-declared content-type resolution + active-content rejection —
 *     defense in depth against the stored-XSS surface `applySafeObjectResponseHeaders`
 *     also guards on read (a "PNG that is really HTML" is caught here).
 *  2. key sanitization / `assertSafeKey` — prevents path traversal or control
 *     characters in the derived key (mirrors `storage/key-codec.ts` constraints),
 *     including for caller-supplied custom key functions.
 */

/** Content-type resolution mode. */
export type SniffMode = 'prefer' | 'require' | 'off';

/** Declarative validation options applied before/around the write. */
export interface UploadValidateOptions {
  /** Hard byte cap. Default = config `maxObjectSizeMb` * 1MiB (applied by the caller). */
  maxBytes?: number;
  /** Exact types and `type/*` wildcards, matched against the RESOLVED type. */
  allowedContentTypes?: string[];
  /** Reject bodies that sniff as HTML/XHTML/SVG. Default true. */
  rejectActiveContent?: boolean;
  /** `'prefer'` (sniff, fall back to declared) | `'require'` (must sniff) | `'off'`. Default `'prefer'`. */
  sniffContentType?: SniffMode;
}

/** Built-in key-generation strategies. */
export type KeyStrategyName = 'uuid' | 'uuid-flat' | 'sha256' | 'original';

/** Context handed to a key strategy. */
export interface KeyStrategyContext {
  /** multer originalname / caller hint. */
  filename?: string;
  /** Resolved content type. */
  contentType: string;
  /** Present only after the write for `'sha256'` (see {@link resolveKey}). */
  sha256?: string;
  /** Sanitized extension incl. leading dot, or `''`. */
  ext: string;
}

/** A built-in strategy name or a custom function that derives the key. */
export type KeyStrategy = KeyStrategyName | ((ctx: KeyStrategyContext) => string);

/** Stable error `code` union so hosts can branch (all map to HTTP 400). */
export type UploadValidationCode =
  | 'too_large'
  | 'active_content'
  | 'type_not_allowed'
  | 'no_content_type'
  | 'invalid_key';

/**
 * Thrown by the validation / key helpers on a rejected upload. NOT an S3 domain
 * error (those are for the wire path) — kept distinct so callers can
 * `instanceof`-branch and map `statusHint` (400) to a `BadRequestException`.
 */
export class UploadValidationError extends Error {
  override readonly name = 'UploadValidationError';
  /** HTTP status a host should map this to. */
  readonly statusHint = 400 as const;
  constructor(
    message: string,
    readonly code: UploadValidationCode,
  ) {
    super(message);
  }
}

/** Filesystem-per-segment cap the key codec enforces (bytes). */
const MAX_KEY_SEGMENT_BYTES = 255;
/** Overall S3 key length cap (bytes). */
const MAX_KEY_BYTES = 1024;
/** Cap the sanitized filename base so a derived key stays well within limits. */
const MAX_BASE_LEN = 96;
/** Cap the sanitized extension (incl. leading dot). */
const MAX_EXT_LEN = 16;

/** Control characters (C0 range + DEL) — never allowed in keys/filenames. */
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\x00-\x1f\x7f]/;
/** Global variant for stripping. */
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS_GLOBAL = /[\x00-\x1f\x7f]/g;

/** Normalize a content type to its lowercased type/subtype (drops `;charset=…`). */
function normalizeType(contentType: string): string {
  return contentType.split(';', 1)[0].trim().toLowerCase();
}

/**
 * Resolve the effective content type from the declared and sniffed values.
 *  - `'off'`     → `declared ?? 'application/octet-stream'`.
 *  - `'prefer'`  → `sniffed ?? declared ?? 'application/octet-stream'`.
 *  - `'require'` → `sniffed`, or throws when the body could not be sniffed.
 *
 * The sniffed value always wins when present: `declared` is caller-controlled and
 * untrusted, so preferring the sniffed type closes the "PNG that is really HTML"
 * hole.
 */
export function resolveContentType(
  declared: string | undefined,
  sniffed: string | undefined,
  mode: SniffMode = 'prefer',
): string {
  if (mode === 'off') {
    return declared?.trim() || 'application/octet-stream';
  }
  if (mode === 'require') {
    if (!sniffed) {
      throw new UploadValidationError('could not determine content type', 'no_content_type');
    }
    return sniffed;
  }
  // 'prefer'
  return sniffed ?? (declared?.trim() || 'application/octet-stream');
}

/** True iff `type` matches an allowlist entry (exact, a `family/*` wildcard, or match-any). */
function matchesAllowed(type: string, allowed: string[]): boolean {
  const family = type.split('/', 1)[0];
  for (const raw of allowed) {
    const entry = raw.trim().toLowerCase();
    if (entry === '') continue;
    if (entry === '*' || entry === '*/*') return true;
    if (entry.endsWith('/*')) {
      const entryFamily = entry.slice(0, -2);
      // Guard a bare/empty `*` family from matching all (an explicit `*/*` above does).
      if (entryFamily.length > 0 && entryFamily !== '*' && entryFamily === family) return true;
    } else if (entry === type) {
      return true;
    }
  }
  return false;
}

/**
 * Assert a resolved upload passes the validation options. Throws
 * `UploadValidationError` with the matching `code` on the first failure.
 *
 * When `size` is `undefined` (a streamed body of unknown length) the byte-cap
 * check is skipped here — it is enforced downstream by the writer's `maxSize`
 * (TASK-2433) which aborts a streamed oversize body mid-write.
 */
export function assertValid(
  resolvedType: string,
  size: number | undefined,
  opts: UploadValidateOptions = {},
): void {
  if (size !== undefined && opts.maxBytes !== undefined && size > opts.maxBytes) {
    throw new UploadValidationError(
      `object is ${size} bytes, which exceeds the ${opts.maxBytes}-byte limit`,
      'too_large',
    );
  }
  const type = normalizeType(resolvedType);
  if (opts.rejectActiveContent !== false && isActiveContentType(resolvedType)) {
    throw new UploadValidationError(
      `content type '${type}' is active content and is not allowed`,
      'active_content',
    );
  }
  if (opts.allowedContentTypes && opts.allowedContentTypes.length > 0) {
    if (!matchesAllowed(type, opts.allowedContentTypes)) {
      throw new UploadValidationError(
        `content type '${type}' is not in the allowed list`,
        'type_not_allowed',
      );
    }
  }
}

/** Sanitize `ext` (leading dot included) to a safe `.[a-z0-9]+`, or `''`. */
function sanitizeExt(ext: string): string {
  const stripped = ext.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (stripped.length === 0) return '';
  return `.${stripped}`.slice(0, MAX_EXT_LEN);
}

/**
 * Sanitize a caller/multer filename into `{ base, ext }`, the anti-traversal gate
 * for the `'original'` key strategy. Takes the basename only (drops any directory
 * part on either separator), strips control chars + NUL, collapses whitespace,
 * strips leading dots (so `.`/`..`/dotfiles can't traverse or hide), and caps the
 * length. Either field may be `''`.
 */
export function sanitizeFilename(name: string | undefined): { base: string; ext: string } {
  // Basename only — drop any directory part on POSIX or Windows separators.
  const basename = (name ?? '').split(/[/\\]/).pop() ?? '';
  // Strip control chars + NUL, collapse whitespace, drop leading dots.
  const cleaned = basename
    .replace(CONTROL_CHARS_GLOBAL, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '')
    .trim();
  if (cleaned.length === 0) return { base: '', ext: '' };

  const dot = cleaned.lastIndexOf('.');
  let base = cleaned;
  let ext = '';
  if (dot > 0) {
    base = cleaned.slice(0, dot);
    ext = cleaned.slice(dot);
  }
  // Keep only filesystem-safe base characters, re-drop any leading dots, then cap.
  base = base
    .replace(/[^A-Za-z0-9._-]/g, '_')
    .replace(/^\.+/, '')
    .slice(0, MAX_BASE_LEN);
  return { base, ext: sanitizeExt(ext) };
}

/**
 * Final safety gate every derived key passes through: rejects an empty key, a
 * leading `/`, `.`/`..` path segments, control characters, an over-long segment,
 * or an over-long key — so a custom `KeyStrategy` cannot reintroduce traversal or
 * injection. Mirrors the constraints in `storage/key-codec.ts`. Returns the key
 * on success.
 */
export function assertSafeKey(key: string): string {
  if (typeof key !== 'string' || key.length === 0) {
    throw new UploadValidationError('derived object key is empty', 'invalid_key');
  }
  if (key.startsWith('/')) {
    throw new UploadValidationError('object key must not start with "/"', 'invalid_key');
  }
  if (CONTROL_CHARS.test(key)) {
    throw new UploadValidationError('object key contains control characters', 'invalid_key');
  }
  const segments = key.split('/');
  for (const seg of segments) {
    if (seg === '.' || seg === '..') {
      throw new UploadValidationError('object key contains a path-traversal segment', 'invalid_key');
    }
    if (Buffer.byteLength(seg, 'utf8') > MAX_KEY_SEGMENT_BYTES) {
      throw new UploadValidationError('object key segment is too long', 'invalid_key');
    }
  }
  if (Buffer.byteLength(key, 'utf8') > MAX_KEY_BYTES) {
    throw new UploadValidationError('object key is too long', 'invalid_key');
  }
  return key;
}

/**
 * Derive the object key for `strategy` from `ctx`, then run the result through
 * {@link assertSafeKey}. Built-ins:
 *  - `'uuid'`      → `` `${year}/${uuid}${ext}` `` (matches the README recipe shape).
 *  - `'uuid-flat'` → `` `${uuid}${ext}` ``.
 *  - `'sha256'`    → `` `${sha.slice(0,2)}/${sha}${ext}` `` — content-addressed. Requires
 *    the post-write digest (`ctx.sha256`), so `uploadFrom` resolves it *after* the
 *    write; identical content re-uploads to the same key (idempotent).
 *  - `'original'`  → sanitized `` `${base}${ext}` ``; falls back to `'uuid'` when the
 *    sanitized name is empty.
 *  - function      → called, then `assertSafeKey`-checked (so it can't reintroduce
 *    traversal / control chars).
 */
export function resolveKey(strategy: KeyStrategy, ctx: KeyStrategyContext): string {
  if (typeof strategy === 'function') {
    return assertSafeKey(strategy(ctx));
  }
  switch (strategy) {
    case 'uuid':
      return assertSafeKey(`${new Date().getUTCFullYear()}/${randomUUID()}${ctx.ext}`);
    case 'uuid-flat':
      return assertSafeKey(`${randomUUID()}${ctx.ext}`);
    case 'sha256': {
      if (!ctx.sha256) {
        throw new UploadValidationError(
          "the 'sha256' key strategy requires the post-write digest",
          'invalid_key',
        );
      }
      return assertSafeKey(`${ctx.sha256.slice(0, 2)}/${ctx.sha256}${ctx.ext}`);
    }
    case 'original': {
      const { base, ext } = sanitizeFilename(ctx.filename);
      if (base.length === 0) {
        return resolveKey('uuid', ctx);
      }
      return assertSafeKey(`${base}${ext || ctx.ext}`);
    }
    default:
      throw new UploadValidationError(`unknown key strategy '${String(strategy)}'`, 'invalid_key');
  }
}
