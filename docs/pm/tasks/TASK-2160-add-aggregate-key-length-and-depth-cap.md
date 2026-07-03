---
id: TASK-2160
title: Add aggregate key-length and depth cap at the key ingress seam
story: STORY-0706
status: ready
type: implementation
size: XS
---

## Description
Remediates audit finding #15 (`CWE-770` Allocation of Resources Without Limits or
Throttling). `encodeSegment` caps each key segment at 255 bytes (`key-codec.ts:77`)
but no caller caps the *total* key length or segment count, so S3's 1024-byte key
limit is not enforced. A key with hundreds of single-character segments
(`a/a/a/.../a`) reaches `BlobStore.putBlob` → `ensureDir(dirname(finalPath))` →
`fs.mkdir(path, { recursive: true })` and creates one directory per segment,
consuming inodes and eventually hitting `PATH_MAX` and surfacing as an opaque `500`
(`ENAMETOOLONG`). Containment is not at issue (the bucket segment is regex-validated
and `encodeKey` neutralizes traversal within the key, so the tree stays inside
`DATA_DIR`); this is purely a resource / spec-parity gap. The fix enforces the S3
key-length limit once, at the shared ingress seam, converting these into a
deterministic `400`.

## Files to create / modify
- `libs/nestjs/src/lib/s3/routing/route-resolver.ts` — modify: after resolving
  `key` (line 44, `const key = ob.keyRaw ?? ob.key ?? ''`), reject when
  `Buffer.byteLength(key, 'utf8') > 1024` (and optionally when the '/'-segment count
  exceeds a defensive cap), throwing an S3 `400` error before returning.
- `libs/nestjs/src/lib/s3/errors/s3-error.ts` — modify: add an S3-layer
  `KeyTooLongError` (AWS code `KeyTooLongError`, `httpStatus = 400`) alongside the
  existing `InvalidArgumentError` (line 37), or reuse `InvalidArgumentError` if a new
  code is undesirable. Note this is distinct from the plain `KeyTooLongError` already
  in `key-codec.ts:15` (which is the per-segment guard, not an `S3Error`).

## Implementation notes
- Root cause per the finding: "`encodeSegment` caps each segment at 255 bytes but no
  caller caps total key length or segment count. S3 caps keys at 1024 bytes;
  openbucket does not." Data flow confirmed by the verifier: URL path →
  `RequestClassifierMiddleware.decodeKey` (no length check) → `RouteResolver.resolve`
  (validates only the bucket vs `BUCKET_NAME_RE`, passes key verbatim) →
  `PathResolver.blobPath` → `BlobStore.putBlob` → `ensureDir` → `fs.mkdir(..., { recursive: true })`.
- Place the aggregate check in `RouteResolver.resolve` (line 30) — the finding's
  recommended seam: "best placed in `RouteResolver.resolve` or the classifier, so
  LIST/GET/DELETE share it". Reject when `Buffer.byteLength(key, 'utf8') > 1024`.
- Keep the existing per-segment 255-byte cap in `encodeSegment` (`key-codec.ts:77`)
  unchanged — it is complementary, not replaced.
- Optionally cap segment count as defense-in-depth: "a defensive limit e.g. <= 1024
  segments bounds directory-tree depth/inode fan-out." S3 itself has no hard segment
  cap, so keep this generous.
- Fix goal (finding fix note): "reject when `Buffer.byteLength(key,'utf8') > 1024`"
  with "a proper 4xx S3 error ... instead of letting them reach `fs.mkdir` and blow
  up as `ENAMETOOLONG` 500s." CWE: `CWE-770`.

## Acceptance criteria
- [ ] A PUT/GET/DELETE with a key of 1025+ UTF-8 bytes returns an S3 `400`
      (`KeyTooLongError`/`InvalidArgument`) from `RouteResolver.resolve`, and no
      directory is created under `DATA_DIR` for that request.
- [ ] A key of exactly 1024 bytes is accepted (boundary).
- [ ] Keys with multi-byte UTF-8 characters are measured by byte length, not string
      length (e.g. a 600-character all-`é` key = 1200 bytes is rejected).
- [ ] The per-segment 255-byte cap and existing valid-key behavior are unchanged.
- [ ] `nx test nestjs` passes, including the new [TEST-0706] key-length cases.

## Test obligations
- Unit: covered by [TEST-0706] (over-length key → `400`; 1024-byte boundary accepted;
  multi-byte byte-length counting).
- E2E: covered by [TEST-0706] (PUT of an over-long key returns `400`, not `500`, and
  creates no directory tree).
- Conformance: N/A.

## Dependencies
- Blocked by: none. Independent of [TASK-2161] and [TASK-2162].

## References
- White-box security audit, 2026-07-04 — finding #15 (`CWE-770`).
- `libs/nestjs/src/lib/s3/routing/route-resolver.ts:30,44`
- `libs/nestjs/src/lib/storage/key-codec.ts:77` (per-segment cap, retained)
- `libs/nestjs/src/lib/s3/errors/s3-error.ts:37` (`InvalidArgumentError`)
