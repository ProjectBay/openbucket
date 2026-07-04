---
id: STORY-0706
title: Input validation & filesystem hardening
epic: EPIC-08
status: ready
size: S
risk: low
---

## User story
As an operator embedding `@openbucket/nestjs` on a hostile network, I want the
storage key ingress, SPA asset serving, and multipart listing paths to reject or
neutralize malformed input, so that an authenticated tenant cannot amplify inode
consumption with over-long keys, a stray symlink cannot escape the SPA root, and
`prefix` filters behave as literal S3 prefixes rather than SQL `LIKE` patterns.

## Description
This Story closes the three `INFO`-severity input-validation / filesystem findings
from the 2026-07-04 white-box audit (#15, #16, #17). None is remotely exploitable
in the shipped threat model, so this is defense-in-depth and S3 spec-conformance
work: (1) enforce an aggregate 1024-byte key-length / segment-count cap at the key
ingress seam so over-long keys return a deterministic `400` instead of an opaque
`ENAMETOOLONG` `500` from `fs.mkdir`; (2) add a `fs.realpathSync` re-check after the
lexical containment test in `safeAssetPath` so a target-escaping symlink inside the
SPA root can never be served; (3) replace the `$like` prefix filter in
`listMultipartUploads` with the same indexed byte-wise range scan the object-listing
paths already use, so `%`/`_` are matched literally. Each fix lands with a
regression test in [TEST-0706].

## Acceptance criteria
- [ ] An S3 object PUT with a key whose UTF-8 byte length exceeds 1024 is rejected
      with an S3 `400` error at the ingress seam, before any `fs.mkdir` runs (no
      `ENAMETOOLONG` `500`).
- [ ] The per-segment 255-byte cap in `encodeSegment` (`key-codec.ts:77`) is
      retained; only the missing *aggregate* cap is added.
- [ ] `safeAssetPath` returns `null` for a path that resolves (via a symlink inside
      the SPA root) to a real target outside the resolved SPA root; a legitimate
      in-root asset still resolves and is served.
- [ ] `GET /:bucket?uploads&prefix=a%25` lists only uploads whose key literally
      starts with `a%`; `%` and `_` in `prefix` are no longer treated as wildcards.
- [ ] The multipart listing path uses the same `nextStringBound`-based range scan as
      `ObjectRepository.listByPrefix`, eliminating the last `$like` prefix filter.

## Tasks
- [TASK-2160] Add aggregate key-length and depth cap at the key ingress seam
- [TASK-2161] Add realpath/symlink re-check in SPA asset serving
- [TASK-2162] Escape LIKE metacharacters in ListMultipartUploads prefix filter

## Test plan
- [TEST-0706] Key-length cap, SPA symlink rejection, and LIKE-metacharacter escaping

## Dependencies
- Blocks: (none)
- Blocked by: none for the three fixes below. Note: [STORY-0700] / [TASK-2100] —
  the critical `CWE-178` unauthenticated admin-API bypass (`GET /api/Admin/backup`
  reaching the handler with no token) is the P0 for EPIC-08 and should land first
  as a patch release; this `INFO`-severity Story carries no urgency and can follow.

## References
- White-box security audit, 2026-07-04 — findings #15 (`CWE-770`, aggregate key-length
  cap), #16 (`CWE-59`, SPA symlink resolution), #17 (`CWE-150`, LIKE-metacharacter
  injection in the multipart prefix filter).
- `libs/nestjs/src/lib/storage/key-codec.ts` — `encodeSegment` / `encodeKey`, per-segment
  255-byte cap at line 77; `KeyTooLongError` at line 15.
- `libs/nestjs/src/lib/s3/routing/route-resolver.ts` — `RouteResolver.resolve` (line 30),
  the shared `(bucket, key)` ingress seam.
- `libs/nestjs/src/lib/spa/spa-utils.ts` — `safeAssetPath` (line 37) and its lexical-only
  containment check (line 42).
- `libs/nestjs/src/lib/domain/multipart/multipart.service.ts` — `listMultipartUploads`
  reads `prefix` at line 88 and interpolates `key: { $like: `${prefix}%` }` at line 96.
- `libs/nestjs/src/lib/persistence/repositories/object.repository.ts` — `listByPrefix`
  (line 34) and the exported `nextStringBound` (line 115) to reuse.
