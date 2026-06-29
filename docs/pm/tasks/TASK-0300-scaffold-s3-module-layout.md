---
id: TASK-0300
title: Scaffold the s3 module directory layout
story: STORY-0100
status: done
type: infra
size: S
---

## Description
Create the `apps/backend/src/s3/` directory layout per §2.1 and the `s3.module.ts` file declaring the controllers, guards, interceptors, and filters. Imports from EPIC-03 and EPIC-04 are referenced via interface tokens (`KeyService`, `ObjectService`, `BucketService`, `MultipartService`) — concrete implementations bind in their respective modules.

## Files to create / modify
- `apps/backend/src/s3/s3.module.ts` — new
- `apps/backend/src/s3/controllers/service.controller.ts` — new (empty shell)
- `apps/backend/src/s3/controllers/bucket.controller.ts` — new (empty shell)
- `apps/backend/src/s3/controllers/object.controller.ts` — new (empty shell)
- `apps/backend/src/s3/controllers/multipart.controller.ts` — new (empty shell)
- `apps/backend/src/s3/sigv4/`, `apps/backend/src/s3/xml/`, `apps/backend/src/s3/errors/`, `apps/backend/src/s3/routing/`, `apps/backend/src/s3/pagination/`, `apps/backend/src/s3/cors/` — new directories
- `apps/backend/src/app.module.ts` — modify (mount `S3Module` last in controller list)

## Implementation notes
- Mirror the directory tree from §2.1 (lines 1080–1108) verbatim:
  ```
  apps/backend/src/s3/
    s3.module.ts
    controllers/
      service.controller.ts          // GET /  -> ListBuckets
      bucket.controller.ts           // /:bucket — all bucket-scope ops
      object.controller.ts           // /:bucket/:key(*) — all object-scope ops
      multipart.controller.ts        // multipart sub-operations
    sigv4/
      sigv4.guard.ts
      sigv4.verifier.ts
      canonical-request.ts
      presigned.ts
      key.service.ts                 // interface only; impl in persistence
    xml/
      xml.interceptor.ts
      xml.serializer.ts
      xml.parser.ts
    errors/
      s3-error.ts                    // abstract base + taxonomy
      s3-exception.filter.ts
    routing/
      route-resolver.ts              // virtual-host vs path-style
      operation.decorator.ts         // @S3Operation('PutObject', {...})
    pagination/
      continuation-token.ts
    cors/
      cors.controller.ts             // OPTIONS preflight per bucket
  ```
- The S3 module is mounted last in `AppModule`'s controller list; classifier middleware (EPIC-01) excludes `/admin/*`, `/api/admin/*`, and SPA prefixes from this tree (§2.1 lines 1110–1113).

## Acceptance criteria
- [ ] All directories listed in §2.1 exist with their named files (even if empty shells initially).
- [ ] `S3Module` declares the four controllers plus `CorsController` (mounted before `ObjectController`).
- [ ] `nx test backend --testPathPattern=s3.module` confirms `S3Module` compiles.

## Test obligations
- Unit: covered by [TEST-0100]
- E2E: N/A — pure scaffolding
- Conformance: N/A

## Dependencies
- Blocked by: [EPIC-01]

## References
- `docs/WHITEPAPER.md` §2.1 (lines 1068–1114)
