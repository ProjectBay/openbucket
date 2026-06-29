---
id: TASK-1550
title: Land the unit-test sample (`bucket.service.spec.ts`)
story: STORY-0505
status: done
type: implementation
size: S
---

## Description
Add `apps/backend/src/domain/buckets/bucket.service.spec.ts` as the canonical unit-test template: boots MikroORM against `:memory:` per suite with `BetterSqliteDriver`, registers `BucketEntity`, calls `getSchemaGenerator().createSchema()` in `beforeEach`, and exercises `BucketService` directly. The principle (BACKEND-DESIGN.md §7.1): do not mock the EntityManager.

## Files to create / modify
- `apps/backend/src/domain/buckets/bucket.service.spec.ts` — new

## Implementation notes
- Verbatim sample from white paper §5.20.1:

  ```ts
  // apps/backend/src/domain/buckets/bucket.service.spec.ts
  import { Test } from '@nestjs/testing';
  import { MikroORM } from '@mikro-orm/core';
  import { MikroOrmModule } from '@mikro-orm/nestjs';
  import { BetterSqliteDriver } from '@mikro-orm/better-sqlite';

  import { BucketService } from './bucket.service';
  import { BucketEntity } from '../../persistence/entities/bucket.entity';

  describe('BucketService', () => {
    let orm: MikroORM;
    let service: BucketService;

    beforeEach(async () => {
      const moduleRef = await Test.createTestingModule({
        imports: [
          MikroOrmModule.forRoot({
            driver: BetterSqliteDriver,
            dbName: ':memory:',
            entities: [BucketEntity],
            allowGlobalContext: true,
          }),
          MikroOrmModule.forFeature([BucketEntity]),
        ],
        providers: [BucketService],
      }).compile();

      orm = moduleRef.get(MikroORM);
      await orm.getSchemaGenerator().createSchema();
      service = moduleRef.get(BucketService);
    });

    afterEach(async () => {
      await orm.close(true);
    });

    it('creates a bucket with default versioning', async () => {
      const b = await service.create({ name: 'photos', region: 'us-east-1' });
      expect(b.name).toBe('photos');
      expect(b.versioning).toBe('disabled');
    });

    it('rejects duplicate bucket names', async () => {
      await service.create({ name: 'photos', region: 'us-east-1' });
      await expect(service.create({ name: 'photos', region: 'us-east-1' }))
        .rejects.toThrow(/already exists/i);
    });

    it('refuses to delete a non-empty bucket', async () => {
      await service.create({ name: 'photos', region: 'us-east-1' });
      // ...seed an object row via repository
      await expect(service.deleteByName('photos')).rejects.toThrow(/not empty/i);
    });
  });
  ```

- `allowGlobalContext: true` is required because the test composes the EM outside a request-scoped `RequestContext`.
- The third assertion (`refuses to delete a non-empty bucket`) is a template stub for downstream Stories to complete with a real repository seed.

## Acceptance criteria
- [ ] The file exists at the path above with the sample's structure.
- [ ] `nx test backend --testPathPattern=bucket.service.spec.ts` runs the suite (passes once `BucketService` exists per [EPIC-03]).
- [ ] No mock or stub of `EntityManager` appears anywhere in the file.

## Test obligations
- Unit: this *is* the unit-test sample; covered by [TEST-0503].
- E2E: N/A.
- Conformance: N/A.

## Dependencies
- Blocked by: _none within EPIC-06 (template can land before BucketService and be unskipped later)_

## References
- `docs/WHITEPAPER.md` §5.20.1 (lines 8740–8799)
- `docs/BACKEND-DESIGN.md` §7.1
