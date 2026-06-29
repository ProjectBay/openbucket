---
id: TEST-0004
title: AppModule wiring and middleware order
covers: [STORY-0004, TASK-0008, TASK-0009, TASK-0010]
status: done
level: unit
---

## Goal
Verify that `AppModule` imports modules in the order documented in §1.3, configures Pino with the documented redact paths, and applies the two middlewares globally in the order request-id-then-classifier.

## Setup
- Boot a Nest application via `Test.createTestingModule` rooted at `AppModule` with stub `Persistence/Storage/Domain/S3/Admin` modules and a valid env.

## Cases
1. Given the booted AppModule, when reading metadata via `Reflector`, then the `imports` array's order matches: `ConfigModule`, `LoggerModule`, `MikroOrmModule`, `CommonModule`, `PersistenceModule`, `StorageModule`, `DomainModule`, `S3Module`, `AdminModule`, `SpaModule`.
2. Given the Pino logger registered, when inspecting `pinoHttp.redact.paths`, then the five paths from §1.3 (`req.headers.authorization`, `req.headers["x-amz-content-sha256"]`, `req.headers["x-amz-security-token"]`, `req.headers.cookie`, `res.headers["set-cookie"]`) are all present.
3. Given an inbound request, when middleware runs, then `req.openbucket.requestId` is set before `req.openbucket.kind` is overwritten by the classifier (RequestId runs first).
4. Given a request with `X-Request-Id: <valid uuid>`, when logged, then the Pino line includes that requestId in `reqId` and the `kind` custom prop.

## Tooling
- Framework: jest + supertest
- Runner: `nx test openbucket-backend --testPathPattern=app.module.spec`

## Pass criteria
- [ ] All four cases pass.
- [ ] No filter or pipe is registered via `app.useGlobalX` in `main.ts` (must come through DI per §1.2.3).

## References
- `docs/WHITEPAPER.md` §1.3 (lines 230–344)
