---
id: STORY-0004
title: Compose AppModule root with ordered imports and middleware
epic: EPIC-01
status: done
size: M
risk: medium
---

## User story
As a developer, I want `AppModule` to import config, logger, persistence, common, domain, storage, S3, admin, and SPA modules in the documented order and to wire `RequestIdMiddleware`/`RequestClassifierMiddleware` for all routes, so that every request receives `req.openbucket` before any controller runs and SPA's catch-all does not shadow the API.

## Description
Realize `apps/backend/src/app.module.ts` per §1.3. Imports in order: `ConfigModule.forRoot({ isGlobal: true, cache: true, validate: loadEnv })`, `LoggerModule.forRootAsync(...)` (Pino with `genReqId` reading `req.openbucket.requestId`, custom props for `kind`/`bucket`, redact of `authorization`/`x-amz-content-sha256`/`x-amz-security-token`/`cookie`/`set-cookie`, dev-only pino-pretty), `MikroOrmModule.forRootAsync` (delegating to `persistence/mikro-orm.config.ts`), `CommonModule`, `PersistenceModule`, `StorageModule`, `DomainModule`, `S3Module`, `AdminModule`, `SpaModule` last. `AppModule.configure(consumer)` applies `RequestIdMiddleware` then `RequestClassifierMiddleware` to `{ path: '*', method: RequestMethod.ALL }`.

## Acceptance criteria
- [ ] Module import order matches §1.3 exactly.
- [ ] `LoggerModule` is registered async with the documented `pinoHttp` options (redact paths, serializers, customProps).
- [ ] `genReqId` reads `req.openbucket.requestId` and falls back to `randomUUID()`.
- [ ] `configure()` applies request-id and classifier middleware in that order, for `*`/`ALL`.
- [ ] Booting with an empty AppModule passes; importing dependent stub modules does not introduce circular DI errors.

## Tasks
- [TASK-0008] Implement AppModule imports list
- [TASK-0009] Wire LoggerModule.forRootAsync with Pino redact and serializers
- [TASK-0010] Apply RequestIdMiddleware + RequestClassifierMiddleware globally

## Test plan
- [TEST-0004] AppModule wiring and middleware order (unit)

## Dependencies
- Blocks: [STORY-0002]
- Blocked by: [STORY-0001], [STORY-0006], [STORY-0007], [STORY-0008], [STORY-0011]

## References
- `docs/WHITEPAPER.md` §1.3 (lines 230–344)
- Interfaces consumed: `loadEnv` + `envSchema` (STORY-0011), `AppConfigService` (STORY-0011), `RequestIdMiddleware` (STORY-0006), `RequestClassifierMiddleware` (STORY-0007), `CommonModule` (STORY-0008), `SpaModule` (STORY-0013); `PersistenceModule`/`StorageModule`/`DomainModule`/`S3Module`/`AdminModule` are scaffolded by STORY-0001
- Interfaces produced: `AppModule` (consumed by STORY-0002)
