---
id: TASK-0617
title: Implement `ObjectRepository` with `listByPrefix` and `nextStringBound`
story: STORY-0206
status: done
type: implementation
size: M
---

## Description
Implement the object-facing repository plus the standalone `nextStringBound(prefix)` helper that bounds prefix range scans. The `listByPrefix` method is the workhorse behind every `ListObjectsV2` request.

## Files to create / modify
- `libs/persistence/src/repositories/object.repository.ts` — new

## Implementation notes
- Extends `EntityRepository<ObjectEntity>` from `@mikro-orm/better-sqlite`.
- Export the `ListPage` interface: `{ items: ObjectEntity[]; isTruncated: boolean; nextMarker?: string; commonPrefixes: string[] }`.
- `findCurrentVersion(bucket: string, key: string): Promise<ObjectEntity | null>` — `this.findOne({ bucket: { name: bucket }, key, softDeleted: false }, { populate: ['bucket'] });`.
- `listByPrefix(bucket: string, prefix: string, marker: string | undefined, limit: number): Promise<{ rows: ObjectEntity[]; truncated: boolean }>`:
  - Build via `this.createQueryBuilder('o').select('*').where({ bucket: bucket, softDeleted: false });`.
  - If `prefix.length > 0`: `const upper = nextStringBound(prefix); qb.andWhere({ key: { $gte: prefix, $lt: upper } });`.
  - If `marker !== undefined && marker.length > 0`: `qb.andWhere({ key: { $gt: marker } });`.
  - `qb.orderBy({ key: 'ASC' }).limit(limit + 1);`.
  - Return `{ rows: all.slice(0, limit), truncated: all.length > limit }`.
- `listVersionsByPrefix(bucket, prefix, keyMarker, versionMarker, limit)` against `ObjectVersion` with `$or` predicate handling both `keyMarker` and `(keyMarker, versionMarker)` modes, ordered `key ASC, createdAt DESC`, limit `limit + 1`.
- `findLatestVersion(bucket, key): Promise<ObjectVersion | null>` — `em.findOne(ObjectVersion, { bucket: bucket, key }, { orderBy: { createdAt: 'DESC' } });`.
- `nextStringBound(prefix)` helper (verbatim algorithm from §3.4.2):
  - `const bytes = Buffer.from(prefix, 'utf8');`
  - Walk back from end; for the first byte `< 0xff`, copy bytes 0..i, increment byte i, return as a `binary` string (byte-pass-through).
  - If no such byte exists (all `0xFF`), return `prefix + '￿'`.

## Acceptance criteria
- [ ] `findCurrentVersion` returns `null` when the matching row has `softDeleted = true`.
- [ ] `listByPrefix(bucket, '', undefined, 3)` over four rows returns `truncated = true` and three rows.
- [ ] `listByPrefix(bucket, 'photos/', undefined, 100)` issues SQL with `>=` and `<` predicates (no `LIKE`); verified by intercepting the generated query string.
- [ ] `nextStringBound('foo')` returns `'fop'`.
- [ ] `nextStringBound('\xff\xff')` returns `'\xff\xff￿'`.

## Test obligations
- Unit: covered by [TEST-0206]
- E2E: N/A
- Conformance: N/A

## Dependencies
- Blocked by: [TASK-0605], [TASK-0606]

## References
- `docs/WHITEPAPER.md` §3.4.2 (lines 3734–3871)
