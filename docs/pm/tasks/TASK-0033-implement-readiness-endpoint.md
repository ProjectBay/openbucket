---
id: TASK-0033
title: Implement readiness endpoint with three sub-checks
story: STORY-0012
status: done
type: implementation
size: S
---

## Description
Add the `GET /api/admin/ready` route to `HealthController` per §1.8. The handler must: (1) throw `ServiceUnavailableException({ status: 'draining' })` if `ShutdownState.isShuttingDown` is true, (2) issue `await this.orm.em.getConnection().execute('SELECT 1')` and throw `{ status: 'db-unreachable' }` on error, (3) `await this.blobs.canWrite()` and throw `{ status: 'storage-unwritable' }` on false. Otherwise return `{ status: 'ready' }`.

## Files to create / modify
- `apps/openbucket-backend/src/admin/health/health.controller.ts` — modify

## Implementation notes
- Quote §1.8 (lines 846–867):
  ```ts
  /** Readiness — the process can serve traffic right now. */
  @Public()
  @Get('ready')
  async ready(): Promise<{ status: 'ready' }> {
    if (this.shutdown.isShuttingDown) {
      throw new ServiceUnavailableException({ status: 'draining' });
    }
    try {
      await this.orm.em.getConnection().execute('SELECT 1');
    } catch (err) {
      throw new ServiceUnavailableException({ status: 'db-unreachable' });
    }
    if (!(await this.blobs.canWrite())) {
      throw new ServiceUnavailableException({ status: 'storage-unwritable' });
    }
    return { status: 'ready' };
  }
  ```
- The `BlobStoreHealth` interface (`canWrite(): Promise<boolean>`) is owned by EPIC-03 per §1.8 line 871. This Task only declares the constructor dependency.
- `MikroORM` is injected from `@mikro-orm/core` and provided by EPIC-03's `PersistenceModule`.

## Acceptance criteria
- [ ] All three sub-checks fire in the order: shutdown, SQLite, blob storage.
- [ ] Each failure throws `ServiceUnavailableException` with the documented `status` string.
- [ ] Success returns `{ status: 'ready' }` with HTTP 200.

## Test obligations
- Unit: N/A
- E2E: covered by [TEST-0013]
- Conformance: N/A

## Dependencies
- Blocked by: [TASK-0032], [TASK-0037]

## References
- `docs/WHITEPAPER.md` §1.8 (lines 846–871)
