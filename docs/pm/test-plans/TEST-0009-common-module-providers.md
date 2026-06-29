---
id: TEST-0009
title: CommonModule provider registration
covers: [STORY-0008, TASK-0019, TASK-0020, TASK-0021]
status: done
level: unit
---

## Goal
Verify `CommonModule` is `@Global()`, registers the documented `APP_FILTER`/`APP_PIPE`/`APP_INTERCEPTOR` providers in LIFO order, and re-exports the config module plus middlewares.

## Setup
- Use `Test.createTestingModule({ imports: [CommonModule] }).compile()` and introspect provider tokens.

## Cases
1. Given the compiled module, when reading `Reflect.getMetadata('imports', CommonModule)`, then it contains exactly `AppConfigInternalModule`.
2. Given the compiled module, when filtering providers by `APP_FILTER` token, then the order is `[CatchAllExceptionFilter, AdminExceptionFilter, S3ExceptionFilter]`.
3. Given the compiled module, when filtering providers by `APP_PIPE`, then it is `ZodValidationPipe`.
4. Given the compiled module, when filtering providers by `APP_INTERCEPTOR`, then it is `ShutdownTrackerInterceptor`.
5. Given the compiled module, when reading `exports`, then it contains `AppConfigInternalModule`, `RequestIdMiddleware`, `RequestClassifierMiddleware`.
6. Given an S3-classified request that throws an `S3Error`, when filters fire, then `S3ExceptionFilter` handles it (admin filter is skipped because of the `kind` gate).

## Tooling
- Framework: jest
- Runner: `nx test openbucket-backend --testPathPattern=common.module.spec`

## Pass criteria
- [ ] All six cases pass.

## References
- `docs/WHITEPAPER.md` §1.6 (lines 523–568)
