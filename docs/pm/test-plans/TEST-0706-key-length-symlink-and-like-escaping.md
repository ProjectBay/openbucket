---
id: TEST-0706
title: Key-length cap, SPA symlink rejection, and LIKE-metacharacter escaping
covers: [STORY-0706, TASK-2160, TASK-2161, TASK-2162]
status: ready
level: unit
---

## Goal
Verify the three input-validation / filesystem-hardening fixes in [STORY-0706]:
1. An aggregate 1024-byte key-length cap is enforced at the key ingress seam
   ([TASK-2160]), turning over-long keys into a deterministic S3 `400` instead of an
   `ENAMETOOLONG` `500` and preventing deep directory-tree creation.
2. `safeAssetPath` rejects paths that resolve through a symlink to a target outside
   the real SPA root ([TASK-2161]).
3. `listMultipartUploads` matches `prefix` byte-wise, treating `%`/`_` literally
   rather than as `LIKE` wildcards ([TASK-2162]).

## Setup
- Unit: `nx test nestjs` (jest). In-memory SQLite (MikroORM) per the repo's
  `TEST-1553` convention for the multipart cases; a `tmpdir()` scratch tree for the
  SPA symlink cases (create root, an in-root regular file, an in-root symlink whose
  target is inside root, and an in-root symlink whose target is outside root).
- E2E (optional, `nx e2e nestjs-e2e`): a booted app with a valid ROOT SigV4 credential
  and a test bucket, to exercise the PUT / `?uploads` HTTP paths.
- No external containers required.

## Cases

### [TASK-2160] Aggregate key-length / depth cap
1. Given a key of 1025 UTF-8 bytes, when `RouteResolver.resolve` runs (or a PUT is
   issued), then it throws / responds with an S3 `400` (`KeyTooLongError` or
   `InvalidArgument`) and creates **no** directory under `DATA_DIR/blobs/<bucket>/`.
2. Given a key of exactly 1024 bytes, when resolved, then it is accepted (boundary is
   inclusive of 1024).
3. Given a key of 600 multi-byte characters (all `é`, = 1200 bytes), when resolved,
   then it is rejected — the cap counts `Buffer.byteLength(key, 'utf8')`, not
   `key.length`.
4. Given a deep key `('a/'.repeat(2000) + 'a')` (well over 1024 bytes), when a PUT is
   issued, then the response is a `400` (not a `500`/`ENAMETOOLONG`) and no
   directory-per-segment tree is created.
5. Given an ordinary key `photos/2026/img.jpg`, when resolved, then it passes
   unchanged (no regression) and the per-segment 255-byte cap in `encodeSegment`
   still applies to a single 256-byte segment.

### [TASK-2161] SPA symlink resolution
6. Given a temp SPA root containing `leak -> <outside>/secret.txt`, when
   `safeAssetPath(root, 'leak')` is called, then it returns `null` (real target
   escapes the resolved root).
7. Given an in-root regular file `assets/app.js`, when
   `safeAssetPath(root, 'assets/app.js')` is called, then it returns the absolute
   in-root path (normal serving still works).
8. Given an in-root symlink `alias.js -> ./assets/app.js` (target inside root), when
   `safeAssetPath(root, 'alias.js')` is called, then it returns a non-null in-root
   path (only *escaping* targets are rejected).
9. Given a dangling symlink `broken -> ./nope`, when `safeAssetPath(root, 'broken')`
   is called, then it returns `null` (realpath throws → caught, not propagated).
10. Given a lexical-traversal input `../../etc/passwd`, when
    `safeAssetPath(root, '../../etc/passwd')` is called, then it returns `null`
    (existing lexical guard still holds alongside the new realpath check).

### [TASK-2162] LIKE-metacharacter escaping in multipart prefix
11. Given pending uploads with keys `a%b`, `axb`, `a_c`, `azc` in bucket `b1`, when
    `listMultipartUploads` runs with `prefix = 'a%'`, then only `a%b` is returned
    (`%` is literal, not a wildcard).
12. Given the same uploads, when `prefix = 'a_'`, then only `a_c` is returned
    (`_` is literal, not a single-char wildcard).
13. Given the same uploads, when `prefix = 'a'`, then all four keys are returned
    (literal prefix range scan `[a, nextStringBound('a'))` matches all).
14. E2E: `GET /b1?uploads&prefix=a%25` (Express decodes `%25`→`%`) returns a
    `ListMultipartUploadsResult` containing only the upload keyed `a%b`.
15. Given an empty `prefix`, when the endpoint runs, then it takes the unfiltered
    `bucket.name`-only branch and returns every pending upload (behavior unchanged).

## Tooling
- Framework: jest (unit), supertest / `@aws-sdk/client-s3` (optional e2e).
- Runner: `nx test nestjs` (unit) / `nx e2e nestjs-e2e` (optional HTTP cases).

## Pass criteria
- [ ] Over-length keys (cases 1, 3, 4) yield S3 `400` and no directory tree; 1024-byte
      and ordinary keys (cases 2, 5) pass.
- [ ] `safeAssetPath` returns `null` for escaping and dangling symlinks and for
      lexical traversal (cases 6, 9, 10), and non-null for in-root file and in-root
      symlink (cases 7, 8).
- [ ] Multipart `prefix` filtering is byte-wise literal (cases 11–14) with the
      empty-prefix branch unchanged (case 15); no `$like` remains in the path.

## References
- White-box security audit, 2026-07-04 — findings #15 (`CWE-770`), #16 (`CWE-59`),
  #17 (`CWE-150`).
- `libs/nestjs/src/lib/s3/routing/route-resolver.ts`,
  `libs/nestjs/src/lib/storage/key-codec.ts`,
  `libs/nestjs/src/lib/spa/spa-utils.ts`,
  `libs/nestjs/src/lib/domain/multipart/multipart.service.ts`,
  `libs/nestjs/src/lib/persistence/repositories/object.repository.ts`.
