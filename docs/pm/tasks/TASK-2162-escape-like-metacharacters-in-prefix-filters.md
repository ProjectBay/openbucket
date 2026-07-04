---
id: TASK-2162
title: Escape LIKE metacharacters in ListMultipartUploads prefix filter
story: STORY-0706
status: ready
type: refactor
size: XS
---

## Description
Remediates audit finding #17 (`CWE-150` Improper Neutralization of Escape/Wildcard
Sequences). `listMultipartUploads` reads the S3 `prefix` query param verbatim
(`multipart.service.ts:88`) and interpolates it into a MikroORM `$like` pattern:
`key: { $like: `${prefix}%` }` (`multipart.service.ts:96`). The value is bound as a
SQL parameter, so this is **not** SQL injection, but `%` and `_` inside the
attacker-supplied prefix are interpreted as `LIKE` wildcards by SQLite/libsql and
there is no `ESCAPE` clause. S3 semantics require `prefix` to be a literal byte-wise
prefix — which is exactly how the far more heavily used object-listing path already
works: `ObjectRepository.listByPrefix` uses an indexed range scan
(`key >= prefix AND key < nextStringBound(prefix)`) precisely to avoid `LIKE`. This
multipart route is the sole listing path that treats `prefix` as a pattern. No
authorization boundary is crossed (the filter is always AND-ed with `bucket.name`,
and a caller can already enumerate the whole bucket with an empty prefix), so this is
a correctness / spec-consistency fix with a latent-inconsistency risk, not an
exploitable vulnerability.

## Files to create / modify
- `libs/nestjs/src/lib/domain/multipart/multipart.service.ts` — modify
  `listMultipartUploads` (line ~93–98): replace the `key: { $like: `${prefix}%` }`
  branch with the literal range scan `key: { $gte: prefix, $lt: nextStringBound(prefix) }`.
- `libs/nestjs/src/lib/persistence/repositories/object.repository.ts` — reuse the
  already-exported `nextStringBound` (line 115); add an import in `multipart.service.ts`
  (no code change needed in the repository itself).

## Implementation notes
- Current code (verbatim, `multipart.service.ts:93-98`):
  ```ts
  const rows = await this.em.find(
    MultipartUpload,
    prefix.length > 0
      ? { bucket: { name: bucket }, key: { $like: `${prefix}%` } }
      : { bucket: { name: bucket } },
    { orderBy: { key: 'ASC', initiatedAt: 'ASC' }, limit: maxUploads + 1 },
  );
  ```
- Preferred fix per the finding's fix note: "replace `key: { $like: `${prefix}%` }`
  with `key: { $gte: prefix, $lt: nextStringBound(prefix) }` (`nextStringBound` is
  exported from `persistence/repositories/object.repository.ts`), so prefix is matched
  byte-wise per S3 semantics and the query stays index-friendly." This mirrors
  `ObjectRepository.listByPrefix` (`object.repository.ts:44-48`) and
  `listVersionsByPrefix` (`object.repository.ts:77-80`).
- `nextStringBound(prefix)` (`object.repository.ts:115`) increments the last byte
  `< 0xff` and returns a binary string upper bound (falls back to `prefix + '￿'`),
  so the range `[prefix, upper)` matches exactly the keys that literally start with
  `prefix`.
- Minimal alternative the finding also permits (only if a range scan is undesirable
  here): escape `LIKE` metacharacters — `prefix.replace(/([%_\\])/g, '\\$1')` — and add
  an explicit `ESCAPE '\\'` clause. The range-scan fix is preferred because it removes
  the inconsistency rather than patching it.
- Keep the empty-prefix branch unchanged (it already skips the filter). CWE: `CWE-150`.

## Acceptance criteria
- [ ] `GET /:bucket?uploads&prefix=a%25` returns only uploads whose key literally
      starts with `a%` (Express has already percent-decoded `%25` to `%`); a `%` in
      the prefix no longer acts as a wildcard.
- [ ] A prefix containing `_` matches literally (e.g. `a_` does not match `axb`).
- [ ] A normal literal prefix (`photos/`) returns the same result set as before.
- [ ] The multipart listing path contains no remaining `$like`; it uses
      `nextStringBound`, consistent with `ObjectRepository.listByPrefix`.
- [ ] `nx test nestjs` passes, including the new [TEST-0706] LIKE-metacharacter cases.

## Test obligations
- Unit: covered by [TEST-0706] (seed uploads `a%b`, `axb`, `a_c`, `azc`; assert
  `prefix=a%` returns only `a%b`, `prefix=a_` returns only `a_c`).
- E2E: covered by [TEST-0706] (`GET /:bucket?uploads&prefix=a%25` over a bucket with
  wildcard-lookalike keys returns only the literal match).
- Conformance: N/A (behavior matches AWS S3 literal-prefix semantics; existing
  multipart conformance suites should continue to pass).

## Dependencies
- Blocked by: none. Independent of [TASK-2160] and [TASK-2161].

## References
- White-box security audit, 2026-07-04 — finding #17 (`CWE-150`).
- `libs/nestjs/src/lib/domain/multipart/multipart.service.ts:88,96`
- `libs/nestjs/src/lib/persistence/repositories/object.repository.ts:44-48,77-80,115`
  (`listByPrefix`, `listVersionsByPrefix`, `nextStringBound`)
