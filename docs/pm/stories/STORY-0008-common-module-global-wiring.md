---
id: STORY-0008
title: Wire CommonModule with global filters, pipes, interceptors
epic: EPIC-01
status: done
size: S
risk: low
---

## User story
As a developer, I want a single `@Global() CommonModule` to register cross-cutting concerns (filters, validation pipe, shutdown tracker interceptor, middlewares) so that they execute inside MikroORM's `RequestContext` and other modules consume them without re-importing.

## Description
Implement `apps/backend/src/common/common.module.ts` per §1.6. Imports: `AppConfigInternalModule` (the local `config.module.ts`). Providers: `RequestIdMiddleware`, `RequestClassifierMiddleware`, `ShutdownTrackerInterceptor`, `{ provide: APP_PIPE, useClass: ZodValidationPipe }`, three `APP_FILTER` providers in LIFO order (`CatchAllExceptionFilter`, `AdminExceptionFilter`, `S3ExceptionFilter`), `{ provide: APP_INTERCEPTOR, useClass: ShutdownTrackerInterceptor }`. Exports: `AppConfigInternalModule`, `RequestIdMiddleware`, `RequestClassifierMiddleware`. Annotated `@Global()`.

## Acceptance criteria
- [ ] `CommonModule` is `@Global()`.
- [ ] Filter providers are registered in LIFO order: catch-all first, admin second, S3 third (so S3 sits on top).
- [ ] `ZodValidationPipe` is registered via `APP_PIPE`.
- [ ] `ShutdownTrackerInterceptor` is registered via `APP_INTERCEPTOR`.
- [ ] `AppConfigInternalModule`, `RequestIdMiddleware`, `RequestClassifierMiddleware` are re-exported.

## Tasks
- [TASK-0019] Implement CommonModule providers and exports
- [TASK-0020] Register global filters in LIFO order
- [TASK-0021] Register ZodValidationPipe and ShutdownTrackerInterceptor

## Test plan
- [TEST-0009] CommonModule provider registration (unit)

## Dependencies
- Blocks: [STORY-0004]
- Blocked by: [STORY-0005], [STORY-0006], [STORY-0007], [STORY-0009], [STORY-0010], [STORY-0011], [STORY-0014]

## References
- `docs/WHITEPAPER.md` §1.6 (lines 523–568)
- Interfaces consumed: all providers listed above
- Interfaces produced: `CommonModule` (consumed by STORY-0004)
