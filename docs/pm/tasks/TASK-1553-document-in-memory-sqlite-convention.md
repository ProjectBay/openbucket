---
id: TASK-1553
title: Document the in-memory SQLite per-suite fixture convention
story: STORY-0505
status: done
type: docs
size: XS
---

## Description
Add a top-of-file docblock to `bucket.service.spec.ts` (and a sibling note in the conventions area) capturing the rule: **do not mock the EntityManager**; instead, boot MikroORM against `:memory:` per suite via `MikroOrmModule.forRoot({ driver: BetterSqliteDriver, dbName: ':memory:', allowGlobalContext: true })`, create the schema in `beforeEach`, and close the ORM in `afterEach`.

## Files to create / modify
- `apps/backend/src/domain/buckets/bucket.service.spec.ts` — modify (add docblock; file body lands via [TASK-1550])

## Implementation notes
- The rule is asserted in white paper §5.20.1 opening line:
  > The principle [see §7.1 of `BACKEND-DESIGN.md`]: do not mock the EntityManager. Boot MikroORM against `:memory:` per suite.
- And realized by these key lines (verbatim):

  ```ts
  MikroOrmModule.forRoot({
    driver: BetterSqliteDriver,
    dbName: ':memory:',
    entities: [BucketEntity],
    allowGlobalContext: true,
  }),
  ```

  ```ts
  beforeEach(async () => { /* ... */
    await orm.getSchemaGenerator().createSchema();
  });

  afterEach(async () => {
    await orm.close(true);
  });
  ```

- The docblock should be ≤ 10 lines and link back to `BACKEND-DESIGN.md` §7.1.

## Acceptance criteria
- [ ] `bucket.service.spec.ts` carries a docblock summarizing the rule, with the BACKEND-DESIGN.md cross-reference.
- [ ] The docblock cites the three load-bearing lines (`forRoot({ ... ':memory:' ... })`, `createSchema()`, `orm.close(true)`).

## Test obligations
- Unit: N/A — docs.
- E2E: N/A.
- Conformance: N/A.

## Dependencies
- Blocked by: [TASK-1550]

## References
- `docs/WHITEPAPER.md` §5.20.1 (lines 8740–8743, 8758–8779)
- `docs/BACKEND-DESIGN.md` §7.1
