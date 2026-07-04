---
id: TASK-3310
title: Add cross-bucket search repository query and LIKE-escape helper
story: STORY-1101
status: backlog
type: implementation
size: M
---

## Description

Add the persistence-layer query that powers cross-bucket search: a method on
`ObjectRepository` that scans the `objects` table across all buckets (or one
named bucket) with keyset pagination over `(bucket, key)`. Support two match
modes — `prefix` (indexed byte-wise range scan) and `contains` (safe substring
`LIKE`) — and add a hardened `escapeLikePattern` helper so `%`/`_`/escape-char
in user input match literally, extending the TASK-2162 (CWE-150) posture from
prefix to substring search.

## Files to create / modify

- `libs/nestjs/src/lib/persistence/repositories/object.repository.ts` — modify
  (add `searchAcrossBuckets`, export `escapeLikePattern` + `LIKE_ESCAPE_CHAR`)
- `libs/nestjs/src/lib/persistence/repositories/object.repository.spec.ts` — new
  (unit-test the escape helper + range/keyset logic against a fake/real EM)

## Implementation notes

- Public shapes (serializable; no entity leakage):

  ```ts
  export type SearchMode = 'prefix' | 'contains';

  export interface ObjectSearchCriteria {
    term: string;            // already length/trim-validated by the DTO
    mode: SearchMode;
    bucket?: string;         // optional single-bucket narrowing
    cursor?: { bucket: string; key: string }; // keyset, exclusive lower bound
    limit: number;           // clamped 1..100 by the DTO
  }

  export interface ObjectSearchPage {
    rows: ObjectEntity[];    // length <= limit
    truncated: boolean;      // there was a limit+1'th row
  }

  async searchAcrossBuckets(c: ObjectSearchCriteria): Promise<ObjectSearchPage>;
  ```

- Build with `createQueryBuilder('o')`, always `.andWhere({ softDeleted: false })`
  and `populate: ['bucket']` (rows must carry `bucket.name`). Order
  `qb.orderBy({ bucket: 'ASC', key: 'ASC' })` and `.limit(limit + 1)` to detect
  truncation the same way `listByPrefix` does.
- `mode: 'prefix'` — reuse the existing indexed range scan, NOT `LIKE`:
  `qb.andWhere({ key: { $gte: term, $lt: nextStringBound(term) } })` (reuse the
  exported `nextStringBound`). This rides `ix_objects_bucket_key` when `bucket`
  is fixed.
- `mode: 'contains'` — substring match via a parameterised `LIKE … ESCAPE`. There
  is no safe MikroORM `$like` that escapes wildcards, so use a raw fragment with
  a bound parameter:

  ```ts
  const LIKE_ESCAPE_CHAR = '\\';
  qb.andWhere('o.key LIKE ? ESCAPE ?', [`%${escapeLikePattern(term)}%`, LIKE_ESCAPE_CHAR]);
  ```

  `escapeLikePattern` prefixes each `\`, `%`, and `_` with `LIKE_ESCAPE_CHAR`
  (order matters — escape the escape char FIRST):

  ```ts
  export function escapeLikePattern(s: string): string {
    return s.replace(/[\\%_]/g, (ch) => LIKE_ESCAPE_CHAR + ch);
  }
  ```

- `bucket` filter: `qb.andWhere({ bucket: { name: c.bucket } })` when present.
- Keyset cursor (never OFFSET — deep-pagination DoS): the row after
  `(cursor.bucket, cursor.key)` in `(bucket, key)` order is
  `bucket > cursor.bucket OR (bucket = cursor.bucket AND key > cursor.key)`:

  ```ts
  qb.andWhere({
    $or: [
      { bucket: { name: { $gt: c.cursor.bucket } } },
      { $and: [{ bucket: { name: c.cursor.bucket } }, { key: { $gt: c.cursor.key } }] },
    ],
  });
  ```

- Edge cases / DoS: keys are stored raw UTF-8 (SQLite BINARY collation ⇒ S3
  byte-wise lex order — see `object.repository.ts` header comment), so the cursor
  comparison and `nextStringBound` bound match S3 semantics; a `contains` scan is
  unindexed by nature, so the `limit + 1` cap + the DTO's min-length guard
  (TASK-3311) keep it bounded, and forbidding OFFSET keeps page N as cheap as page
  1. Do not interpolate `term` into SQL — always bind it.

## Acceptance criteria

- [ ] `escapeLikePattern('a%_b\\c')` returns `a\%\_b\\c` (unit-tested).
- [ ] A `contains` search for a literal `%` matches only keys containing a real
      `%` (no full-table match), asserted in the repo spec.
- [ ] A `prefix` search uses `$gte`/`$lt` (no `LIKE`) — asserted by inspecting the
      built query / fake-EM contract, mirroring `multipart.service.spec.ts`.
- [ ] `searchAcrossBuckets` returns `truncated: true` and exactly `limit` rows when
      `limit + 1` rows match; a follow-up call with the last row's cursor returns
      the next disjoint page.
- [ ] `nx test nestjs --testPathPattern=object.repository.spec` passes.

## Test obligations

- Unit: covered by [TEST-1101] (cases 1–3)
- E2E: covered by [TEST-1101] (case 5, via the endpoint)
- Conformance: N/A

## Dependencies

- Blocked by: none

## References

- `libs/nestjs/src/lib/persistence/repositories/object.repository.ts`
  (`listByPrefix`, `listVersionsByPrefix`, `nextStringBound`)
- `libs/nestjs/src/lib/domain/multipart/multipart.service.ts` +
  `…/multipart.service.spec.ts` (TASK-2162 / CWE-150 `$like` avoidance)
- `libs/nestjs/src/lib/persistence/entities/object.entity.ts` (`ix_objects_bucket_key`)
