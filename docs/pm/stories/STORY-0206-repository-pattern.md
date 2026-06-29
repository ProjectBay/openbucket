---
id: STORY-0206
title: Repository pattern (BucketRepository, ObjectRepository)
epic: EPIC-03
status: done
size: M
risk: medium
---

## User story
As a developer, I want `BucketRepository` and `ObjectRepository` with the helper queries used by S3 handlers (`getByName`, `exists`, `isVersioned`, `hasVersionHistory`, `listAll`, `findCurrentVersion`, `listByPrefix`, `listVersionsByPrefix`, `findLatestVersion`), so that controller and service code in EPIC-02 and EPIC-04 does not inline raw queries and pagination math.

## Description
Implement the two custom repositories per §3.4.1 and §3.4.2 — extending MikroORM's `EntityRepository`. The non-trivial method is `ObjectRepository.listByPrefix`: it must use an indexed range scan (`prefix <= key < nextStringBound(prefix)`), apply the marker as a strict-greater-than predicate, request `limit + 1` rows to detect truncation, and order by key ascending. Also implement the helper `nextStringBound(prefix)` exactly as §3.4.2: walk back from the end incrementing the first non-`0xFF` byte; fall back to `prefix + '￿'` for an all-`0xFF` prefix.

## Acceptance criteria
- [x] `BucketRepository` exposes `getByName`, `exists`, `isVersioned`, `hasVersionHistory`, `listAll` per §3.4.1.
- [x] `ObjectRepository.findCurrentVersion(bucket, key)` returns `null` for soft-deleted rows (TEST-0206 case 6).
- [x] `ObjectRepository.listByPrefix` uses `$gte`/`$lt` (no `LIKE`) and returns `{ rows, truncated }` (cases 3–5; the QB construction is source-evident).
- [x] `nextStringBound('foo') === 'fop'`. The `'\xff\xff'` fallback assertion is **only reachable for non-UTF-8 byte input** (0xFF is never a valid UTF-8 byte; §3.4.2's `Buffer.from(prefix, 'utf8')` round-trip can't construct an all-0xFF byte sequence from a valid JS string). The fallback exists as defensive code; the documented happy case is verified.
- [x] `listVersionsByPrefix` and `findLatestVersion` behave per §3.4.2 (TEST-0206 cases 8, 9).

## Tasks
- [TASK-0616] Implement `BucketRepository`
- [TASK-0617] Implement `ObjectRepository` with `listByPrefix` and `nextStringBound`

## Test plan
- [TEST-0206] Repository helpers against in-memory SQLite

## Implementation notes
- Each entity registers its custom repo via `repository: () => XRepo` (lazy to
  resolve the entity↔repo circular import). The persistence module also exposes
  the classes via a `getRepositoryToken`-fed factory so consumers may
  `@Inject(BucketRepository)` *or* `@InjectRepository(Bucket)`.
- `FilterQuery` typing in MikroORM 6 rejects bare PK strings for relations, so
  every `bucket: 'name'` lookup in `ObjectRepository` is written as
  `bucket: { name: 'name' }` (functionally equivalent at the SQL level).

## Dependencies
- Blocks: [EPIC-02], [EPIC-04]
- Blocked by: [STORY-0201], [STORY-0205]

## References
- `docs/WHITEPAPER.md` §3.4.1 (lines 3694–3732), §3.4.2 (lines 3734–3871)
- Interfaces produced: `BucketRepository`, `ObjectRepository`, `ListPage`, `nextStringBound`
