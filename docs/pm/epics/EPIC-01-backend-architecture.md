---
id: EPIC-01
title: Backend architecture & bootstrap
status: backlog
whitepaper_section: "§1"
owner_area: backend
---

## Objective

Deliver the structural backbone of the OpenBucket backend: a single
NestJS process on Express that boots deterministically, classifies
every request once (S3 vs admin vs SPA), validates its environment at
startup, exposes health and readiness endpoints, serves the Angular
admin SPA as static files, and shuts down gracefully under SIGTERM.
This Epic establishes the platform on which every other Epic builds —
it owns nothing about S3 wire format, persistence, streaming, or
authentication, but it is the precondition for all of them.

## Scope

- In scope:
  - Workspace bootstrap and Nx project for `apps/backend`.
  - `main.ts` Express adapter, Pino logger, global pipes/filters/interceptors, body-parser configuration (opt-in per route), server timeouts wired from config.
  - `app.module.ts` composition root and feature-module wiring (without filling in the feature modules' bodies).
  - `Express.Request` augmentation (`req.openbucket`) shared type definition.
  - Request classifier middleware: virtual-host vs path-style detection, kind assignment, request-id (UUIDv7) attachment.
  - `CommonModule`: stub `S3ExceptionFilter` (XML body delegated to S3 Epic), `AdminExceptionFilter` (JSON), global `ZodValidationPipe` registration, request-id middleware.
  - `ConfigModule` backed by a Zod schema with refuse-to-boot semantics for missing required vars.
  - `/api/admin/health` and `/api/admin/ready` endpoints.
  - `ServeStaticModule` configuration for the Angular SPA bundled into `dist/`, including `index.html` fallback and cache headers.
  - Graceful shutdown infrastructure: `ShutdownState`, in-flight tracker, drain coordinator, SIGTERM handling.
- Out of scope:
  - S3 controllers, XML serialization, SigV4 — owned by EPIC-02.
  - MikroORM entities, migrations, BlobStore, `KeyService` — owned by EPIC-03.
  - PUT/GET streaming bodies, multipart handlers, background tick implementations — owned by EPIC-04.
  - Admin auth flow, admin endpoints, Angular app, OpenAPI generation, Docker, CI — owned by EPIC-05 / EPIC-06.

## Success criteria

- `nx serve backend` boots the app, listens on the configured port, and exits non-zero if any required env var is missing.
- A request to `/` is classified as `s3`; a request to `/api/admin/health` is classified as `admin` and returns 200; a request to `/admin/` returns the SPA shell.
- A SIGTERM during a 30-second simulated in-flight request drains cleanly before the process exits.
- `req.openbucket.requestId` is present in every Pino log line.
- The OpenAPI export (later wired in EPIC-05) starts from a server that bootstraps cleanly under this Epic.

## Stories

- [STORY-0001] Scaffold backend Nx app and directory layout
- [STORY-0002] Implement bootstrap main.ts with Express adapter, Pino, timeouts
- [STORY-0003] Implement opt-in body parsers for admin routes
- [STORY-0004] Compose AppModule root with ordered imports and middleware
- [STORY-0005] Augment Express.Request with OpenBucketRequestContext
- [STORY-0006] Implement UUIDv7 request-id middleware
- [STORY-0007] Implement request classifier middleware (S3 vs admin vs SPA)
- [STORY-0008] Wire CommonModule with global filters, pipes, interceptors
- [STORY-0009] Implement S3ExceptionFilter scaffold (XML, request-id, kind gate)
- [STORY-0010] Implement AdminExceptionFilter, catch-all filter, and Zod validation pipe
- [STORY-0011] Implement Zod-validated env schema and AppConfigService
- [STORY-0012] Add /api/admin/health and /api/admin/ready endpoints
- [STORY-0013] Serve Angular admin SPA under /admin with cache headers and fallback
- [STORY-0014] Implement ShutdownState service and in-flight tracker interceptor
- [STORY-0015] Implement SIGTERM shutdown coordinator with drain deadline

## Dependencies

- Blocks: [EPIC-02], [EPIC-03], [EPIC-04], [EPIC-05], [EPIC-06]
- Blocked by: _none_

## References

- `docs/WHITEPAPER.md` §1 (lines 49–1051)
  - §1.1 Directory layout (lines 53–122)
  - §1.2 Bootstrap — `main.ts` (lines 123–229)
  - §1.3 Composition root — `app.module.ts` (lines 230–344)
  - §1.4 Augmenting `Express.Request` (lines 345–382)
  - §1.5 Request classifier middleware (lines 383–522)
  - §1.6 Common module — filters, pipes, interceptors (lines 523–705)
  - §1.7 Config — Zod-validated env (lines 706–817)
  - §1.8 Health and readiness (lines 818–872)
  - §1.9 Static SPA serving (lines 873–919)
  - §1.10 Graceful shutdown (lines 920–1051)
- `docs/ARCHITECTURE.md` §3, §4
- `docs/BACKEND-DESIGN.md` §1
