---
id: STORY-0100
title: S3 controller topology and dispatcher pattern
epic: EPIC-02
status: done
size: M
risk: medium
---

## User story
As a developer, I want the S3 controller tree wired under `apps/backend/src/s3/` with one controller per resource class and a query-based operation dispatcher, so that every S3 verb/path/query combination can be routed to a single handler without per-operation controller proliferation.

## Description
Realize §2.1 of the white paper: create the `s3.module.ts` plus the directory skeleton; implement the `ServiceController`, `BucketController`, `ObjectController`, and `MultipartController` shells; define the `@S3Operation` decorator and operation-dispatcher metadata; and add the Express `Request` augmentation type that exposes `req.openbucket.{kind,style,bucket,keyRaw,requestId,receivedAt,operation,accessKeyId}`. Handlers stay thin — they delegate to domain services injected from EPIC-03 and EPIC-04.

## Acceptance criteria
- [x] `apps/openbucket-backend/src/s3/s3.module.ts` declares all four controllers + `RouteResolver`/`SigV4Guard`/`XmlInterceptor`/`S3ExceptionFilter`/`OperationDispatcherInterceptor` per the §2.1 layout. Stubs for the not-yet-real pieces are clearly marked `SCAFFOLD (STORY-0100)`.
- [x] `ObjectController.put/get/head/post/delete` dispatch per §2.1.1: `uploadId+partNumber`, `x-amz-copy-source`, `tagging`, `acl`, `retention`, `legal-hold`, `uploads`, `restore`, `select`, `delete` (TEST-0100 cases 3–6).
- [x] `BucketController` dispatches `?versioning`/`?cors`/`?lifecycle`/`?tagging`/`?policy`/`?encryption`/`?uploads`/`?delete` per §2.8.2.
- [x] `@S3Operation('<Name>')` + `OperationDispatcherInterceptor` set `req.openbucket.operation` (TEST-0100 case 2).
- [x] `nx test backend --testPathPattern=s3.module` confirms module wiring (case 1); backend suite 179/179.

## Tasks
- [TASK-0300] Scaffold the s3 module directory layout
- [TASK-0301] Implement ObjectController dispatcher
- [TASK-0302] Implement BucketController dispatcher
- [TASK-0303] Implement ServiceController for root GET (ListBuckets entry)
- [TASK-0304] Implement MultipartController routes
- [TASK-0305] Implement @S3Operation decorator and operation dispatcher metadata
- [TASK-0306] Declare express Request augmentation for req.openbucket

## Test plan
- [TEST-0100] S3 controller topology unit

## Implementation notes
- Same scaffold-then-fill pattern as STORY-0200: STORY-0100 consumes 10+
  types from later stories (RouteResolver/0101, XmlInterceptor/0102,
  SigV4Guard/0103, S3Error taxonomy/0105, per-controller
  S3ExceptionFilter/0106, the three domain services in 0107–0110). All are
  shipped as `SCAFFOLD (STORY-0100)` stubs that pass through or throw
  `NotImplementedError`; subsequent stories replace each.
- Routes use NestJS's wildcard form (`@Controller(':bucket')` + `@Get('*')`)
  for the multi-segment object path. Path-param names are decorative — the
  controllers read `(bucket, key)` from `req.openbucket` via the
  RouteResolver (set by the classifier middleware from STORY-0007).
- `ServiceController` is registered but has no routes yet (the `@Get()` for
  `ListBuckets` lands in STORY-0107). Keeps M0's `GET /` e2e passing — it
  still 404s into the global S3ExceptionFilter, which renders XML.
- `ObjectController` for `GET /<bucket>/<key>` now throws
  `NotImplementedError` (501) instead of falling through to a Nest default.
  The M0 classifier e2e only asserts content-type + `<Resource>` (not
  status), so it stays green.
- Existing M0 `S3Error` placeholder at `s3/errors/s3-error.ts` was extended
  in-place with `NotImplementedError`; the M0 global `S3ExceptionFilter`
  (`common/filters/s3-exception.filter.ts`) continues to format whatever
  `S3Error` subclasses bubble up.

## Dependencies
- Blocks: [STORY-0101], [STORY-0107], [STORY-0108], [STORY-0109], [STORY-0110]
- Blocked by: [EPIC-01]

## References
- `docs/WHITEPAPER.md` §2.1 (lines 1068–1241)
- Interfaces produced: `S3Module`, `ObjectController`, `BucketController`, `ServiceController`, `MultipartController`, `@S3Operation` decorator, `req.openbucket` augmentation
- Interfaces consumed: `RouteResolver` (defined in STORY-0101), `SigV4Guard` (defined in STORY-0103), `XmlInterceptor` (defined in STORY-0102), `S3ExceptionFilter` (defined in STORY-0106)
