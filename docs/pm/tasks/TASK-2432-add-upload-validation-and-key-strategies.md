---
id: TASK-2432
title: Add upload validation options and sanitized key strategies
story: STORY-0803
status: backlog
type: implementation
size: M
---

## Description
Add the declarative validation model (max bytes, content-type allowlist, active-content
rejection, sniff mode) and the key-generation strategies that `uploadFrom` ([TASK-2433])
composes. These are pure, side-effect-free helpers plus a typed error, so they can be
unit-tested in isolation and reused. Key strategies must produce keys that are safe
against path traversal and control-character injection.

## Files to create / modify
- `libs/nestjs/src/lib/open-bucket-upload.ts` — new. Public types + pure helpers:
  `UploadValidateOptions`, `KeyStrategy`, `KeyStrategyContext`, `UploadValidationError`,
  `resolveContentType`, `assertValid`, `resolveKey`, `sanitizeFilename`.
- `libs/nestjs/src/lib/open-bucket-upload.spec.ts` — new. Unit tests.
- `libs/nestjs/src/index.ts` — modify (re-export the public types + `UploadValidationError`).

## Implementation notes
- Types:
  ```ts
  export interface UploadValidateOptions {
    /** Hard byte cap. Default = config `maxObjectSizeMb` * 1MiB. */
    maxBytes?: number;
    /** Exact types and `type/*` wildcards, matched against the RESOLVED type. */
    allowedContentTypes?: string[];
    /** Reject bodies that sniff as HTML/XHTML/SVG. Default true. */
    rejectActiveContent?: boolean;
    /** 'prefer' (sniff, fall back to declared) | 'require' (must sniff) | 'off'. Default 'prefer'. */
    sniffContentType?: 'prefer' | 'require' | 'off';
  }

  export type KeyStrategyName = 'uuid' | 'uuid-flat' | 'sha256' | 'original';
  export interface KeyStrategyContext {
    filename?: string;      // multer originalname / caller hint
    contentType: string;    // resolved type
    sha256?: string;        // present only after the write for 'sha256' (see below)
    ext: string;            // sanitized extension incl. leading dot, or ''
  }
  export type KeyStrategy = KeyStrategyName | ((ctx: KeyStrategyContext) => string);
  ```
- `resolveContentType(declared, sniffed, mode)`:
  - `'off'` → `declared ?? 'application/octet-stream'`.
  - `'prefer'` → `sniffed ?? declared ?? 'application/octet-stream'`.
  - `'require'` → `sniffed` or throw `UploadValidationError('could not determine content type')`.
  - When both present and disagree on the top-level type family, prefer the **sniffed**
    value (declared is caller-controlled and untrusted) — this is what closes the
    "PNG that is really HTML" hole.
- `assertValid(resolvedType, size | undefined, opts)`:
  - If `size` known and `size > maxBytes` → `UploadValidationError` (`code: 'too_large'`).
  - `rejectActiveContent !== false` and `isActiveContentType(resolvedType)` →
    `UploadValidationError` (`code: 'active_content'`). Import `isActiveContentType`
    from `domain/objects/object.service.ts` (already exported) — single source of truth.
  - `allowedContentTypes` set and no entry matches (exact or `type/*`) →
    `UploadValidationError` (`code: 'type_not_allowed'`). Wildcard match compares only
    the part before `/`; guard against a bare `*` meaning "any".
  - For a streamed body `size` is unknown here — the byte cap is enforced downstream by
    the writer's `maxSize` ([TASK-2433]); `assertValid` skips the size check when `size`
    is undefined and documents that.
- `UploadValidationError extends Error` with a stable `code` union and a `statusHint`
  (400) so hosts can map it to a `BadRequestException`. It is NOT an S3 domain error
  (those are for the wire path); keep it distinct so callers can `instanceof`-branch.
- `sanitizeFilename(name)`: take `basename` only (drop any directory part), strip
  control chars and NUL, collapse whitespace, strip leading dots (`.`/`..` → no
  traversal), cap length; return `{ base, ext }`. This is the anti-traversal gate for
  the `'original'` strategy.
- `resolveKey(strategy, ctx)`:
  - `'uuid'` → `` `${new Date().getUTCFullYear()}/${randomUUID()}${ctx.ext}` `` (matches
    today's recipe key shape).
  - `'uuid-flat'` → `` `${randomUUID()}${ctx.ext}` ``.
  - `'sha256'` → `` `${ctx.sha256!.slice(0,2)}/${ctx.sha256}${ctx.ext}` `` — content-addressed;
    requires the post-write digest (the writer computes sha256), so `uploadFrom` resolves
    this strategy *after* the write and, if the object already exists, is naturally
    idempotent. Document that constraint here.
  - `'original'` → sanitized `` `${base}${ext}` ``; if empty after sanitizing, fall back
    to `'uuid'`.
  - function form → call it, then run the result through a final `assertSafeKey` that
    rejects leading `/`, `..` segments, control chars, and over-length keys
    (consistency with `storage/key-codec.ts` constraints) so a custom strategy can't
    reintroduce traversal.
- Security: the two load-bearing gates are (1) sniffed-over-declared type resolution +
  active-content rejection (defense in depth against the stored-XSS surface that
  `applySafeObjectResponseHeaders` also guards on read), and (2) key sanitization /
  `assertSafeKey` preventing traversal or control chars in the derived key. No new authz
  is added or removed — validation runs entirely on the trusted in-process side.

## Acceptance criteria
- [ ] `resolveContentType` returns sniffed over declared in `'prefer'`, throws in
  `'require'` when sniff is undefined, and passes declared through in `'off'`.
- [ ] `assertValid` throws `UploadValidationError` with the right `code` for oversize,
  active-content, and disallowed-type inputs, and passes a valid input.
- [ ] `allowedContentTypes: ['image/*']` accepts `image/png` and rejects
  `application/pdf`; `['image/png']` rejects `image/jpeg`.
- [ ] `sanitizeFilename('../../etc/passwd')` yields no directory part and no `..`.
- [ ] `resolveKey` for each strategy returns a key that passes `assertSafeKey`; a custom
  strategy returning `'../evil'` is rejected.
- [ ] `nx test nestjs --testPathPattern=open-bucket-upload` passes.

## Test obligations
- Unit: covered by [TEST-0803] (validation + key-strategy case groups).
- E2E: N/A — pure helpers (exercised end-to-end via [TASK-2433]).
- Conformance: N/A.

## Dependencies
- Blocked by: [TASK-2430] (content sniffing feeds `resolveContentType`).

## References
- `libs/nestjs/src/lib/domain/objects/object.service.ts` — `isActiveContentType` (reused).
- `libs/nestjs/src/lib/storage/key-codec.ts` — key constraints `assertSafeKey` mirrors.
- `libs/nestjs/src/lib/common/config/app-config.service.ts` — `maxObjectSizeMb` (default cap).
- `libs/nestjs/README.md` recipe — current key shape `${year}/${uuid}${ext}` (preserved by `'uuid'`).
