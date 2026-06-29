---
id: TASK-0001
title: Create backend source directory tree per §1.1
story: STORY-0001
status: done
type: infra
size: XS
---

## Description
Create the directories listed in §1.1 under `apps/openbucket-backend/src/`: `common/{config,middleware,filters,pipes,interceptors,types}/`, `s3/`, `admin/health/`, `domain/{buckets,objects,multipart,lifecycle,keys}/`, `storage/`, `persistence/`, `spa/`, `bootstrap/`. Add a `.gitkeep` to each empty directory.

## Files to create / modify
- `apps/openbucket-backend/src/common/` — new (plus `config/`, `middleware/`, `filters/`, `pipes/`, `interceptors/`, `types/`)
- `apps/openbucket-backend/src/s3/` — new
- `apps/openbucket-backend/src/admin/health/` — new
- `apps/openbucket-backend/src/domain/` — new (plus `buckets/`, `objects/`, `multipart/`, `lifecycle/`, `keys/`)
- `apps/openbucket-backend/src/storage/` — new
- `apps/openbucket-backend/src/persistence/` — new
- `apps/openbucket-backend/src/spa/` — new
- `apps/openbucket-backend/src/bootstrap/` — new

## Implementation notes
- Mirror the §1.1 tree exactly:
  ```
  apps/backend/src/
    main.ts
    app.module.ts
    common/
      common.module.ts
      config/{env.schema.ts, config.module.ts, app-config.service.ts}
      middleware/{request-id.middleware.ts, request-classifier.middleware.ts}
      filters/{s3-exception.filter.ts, admin-exception.filter.ts, catch-all.filter.ts}
      pipes/zod-validation.pipe.ts
      interceptors/shutdown-tracker.interceptor.ts
      types/request.d.ts
    s3/...
    admin/health/{health.controller.ts, health.module.ts}
    domain/...
    storage/storage.module.ts
    persistence/{persistence.module.ts, mikro-orm.config.ts}
    spa/spa.module.ts
    bootstrap/{body-parser.ts, shutdown.ts}
  ```
- Subsequent Stories fill the file bodies; this Task only creates the directories.

## Acceptance criteria
- [ ] All directories listed above exist.
- [ ] `git status` shows the directories tracked via `.gitkeep` (or initial placeholder modules from TASK-0002).
- [ ] `nx build openbucket-backend` succeeds.

## Test obligations
- Unit: covered by [TEST-0001]
- E2E: N/A — pure infra
- Conformance: N/A

## Dependencies
- Blocked by: _none_

## References
- `docs/WHITEPAPER.md` §1.1 (lines 53–122)
