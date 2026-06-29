---
id: TEST-0100
title: S3 controller topology unit
covers: [STORY-0100, TASK-0300, TASK-0301, TASK-0302, TASK-0303, TASK-0304, TASK-0305, TASK-0306]
status: done
level: unit
---

## Goal
Verify that the S3 controller tree is wired per §2.1 — `S3Module` boots, all controllers/guards/interceptors are declared, the `@S3Operation` decorator propagates to `req.openbucket.operation`, and the dispatch branches in `ObjectController` route per the §2.1.1 matrix.

## Setup
- Jest in `apps/backend`.
- `Test.createTestingModule({ imports: [S3Module], providers: [ /* mock */ KeyService, ObjectService, BucketService, MultipartService ] })`.

## Cases
1. Given an `S3Module` compiled with mocked services, when `app.init()` runs, then no provider is missing and all four controllers register.
2. Given a fake `req.openbucket` and a controller method decorated with `@S3Operation('PutObject')`, when called, then `req.openbucket.operation === 'PutObject'` after the interceptor runs.
3. Given a `PUT /b/k?uploadId=u&partNumber=1`, when dispatched by `ObjectController.put`, then `MultipartService.uploadPart` is called (not `ObjectService.putObject`).
4. Given a `PUT /b/k?uploadId=u&partNumber=1` with `x-amz-copy-source: src/key`, when dispatched, then `MultipartService.uploadPartCopy` is called.
5. Given a `POST /b/k?uploads`, when dispatched, then `MultipartService.createUpload` is called.
6. Given a `POST /b/k?select`, when dispatched, then `NotImplementedError('SelectObjectContent')` is thrown.

## Tooling
- Framework: jest
- Runner: `nx test backend --testPathPattern=s3`

## Pass criteria
- [x] All six cases pass (`apps/openbucket-backend/src/s3/s3.module.spec.ts`); backend suite 179/179; e2e 15 passed / 4 POSIX-skipped.
- [x] No `(req as any)` casts in production code — `req.openbucket` is properly typed via the `OpenBucketRequestContext` augmentation, extended in STORY-0100 with `operation` and `accessKeyId`.

## References
- `docs/WHITEPAPER.md` §2.1 (lines 1068–1241), §2.1.1 (lines 1117–1230), §2.8 (lines 2487–2493)
