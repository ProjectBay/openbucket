---
id: EPIC-05
title: Admin API, frontend & auth flow
status: backlog
whitepaper_section: "§5.1–§5.15"
owner_area: frontend
---

## Objective

Deliver the user-facing surface of OpenBucket: the admin JSON API
under `/api/admin/*` with full JWT-based authentication (access token
in `Authorization` header, refresh token in a cookie scoped to
`/api/admin/auth`, rotated on use), the `nestjs-zod` DTO pattern that
also drives OpenAPI, the bucket and object admin endpoints, the
access-key management surface, the initial admin bootstrap with
change-on-first-login, audit logging, and the Angular SPA that
consumes the generated OpenAPI client — including routing, the
single-retry refresh interceptor, the object browser UI, and
signals-based state.

## Scope

- In scope:
  - `AdminModule` tree: `AuthModule`, `BucketsAdminModule`, `ObjectsAdminModule`, `KeysAdminModule`, `SettingsAdminModule`.
  - Auth endpoints: `POST /api/admin/auth/login`, `POST /api/admin/auth/refresh`, `POST /api/admin/auth/logout`, `GET /api/admin/auth/me`.
  - Refresh-token rotation, hashed lookup column + argon2id hash, token-reuse revocation.
  - `JwtAuthGuard` applied to every admin route except auth endpoints.
  - `nestjs-zod` DTO patterns including `createZodDto` + `patchNestjsSwagger`.
  - Admin bucket endpoints (list/create/get/delete).
  - Admin object browser endpoints (list with prefix/delimiter/marker/limit, head, delete).
  - Access-key management endpoints (list/create/disable/delete) — root-only in v1 but surface in place.
  - First-run bootstrap: generate temporary password, force change-on-first-login.
  - Audit logging via Pino with the documented event catalogue.
  - Angular SPA structure under `apps/frontend/`: feature modules, standalone components, signal-based services.
  - `app.routes.ts` with `canActivate` guards.
  - `AuthService` (in-memory access token) + HTTP interceptor with single-retry refresh.
  - Integration with the generated `@openbucket/api-client`.
  - Object browser UI sketch (one or two key component samples).
  - Signal-based state store sample.
- Out of scope:
  - Nest bootstrap, ConfigModule, classifier, exception filters — owned by EPIC-01.
  - S3 wire protocol, XML, SigV4 — owned by EPIC-02.
  - MikroORM entities, migrations, BlobStore, key encoding — owned by EPIC-03.
  - Body streaming, range requests, multipart streaming, background tick — owned by EPIC-04.
  - OpenAPI generation pipeline, Docker, CI, conformance suite — owned by EPIC-06.

## Success criteria

- `POST /api/admin/auth/login` with valid credentials issues an access JWT and sets a rotated refresh cookie scoped to `/api/admin/auth`.
- Replaying a previously-rotated refresh token revokes the chain.
- The Angular SPA logs in, lists buckets, browses objects, and refreshes silently on a single 401.
- An admin upload via `PUT /api/admin/buckets/:name/objects/:key(*)` stores the object through the same domain services the S3 layer uses.
- Audit events are emitted as structured Pino lines for every state-changing call.

## Stories

- [STORY-0400] Wire AdminModule tree and global JWT guard
- [STORY-0401] Stand up AuthModule and AuthService
- [STORY-0402] Implement RefreshTokenService with rotation and reuse revocation
- [STORY-0403] Implement POST /api/admin/auth/login with refresh cookie
- [STORY-0404] Implement POST /api/admin/auth/refresh
- [STORY-0405] Implement POST /api/admin/auth/logout
- [STORY-0406] Implement GET /api/admin/auth/me
- [STORY-0407] Implement JwtAuthGuard global admin guard
- [STORY-0408] Establish nestjs-zod DTO pattern with sample DTOs
- [STORY-0409] Implement admin bucket endpoints
- [STORY-0410] Implement admin object browser endpoints
- [STORY-0411] Implement access-key management endpoints
- [STORY-0412] Initial admin bootstrap and change-password flow
- [STORY-0413] Implement AuditService and event catalogue
- [STORY-0414] Bootstrap Angular SPA structure
- [STORY-0415] Implement SPA routing and auth guards
- [STORY-0416] Implement AuthService and single-retry refresh interceptor
- [STORY-0417] Wire the generated OpenAPI client into the SPA
- [STORY-0418] Object browser UI with prefix/delimiter pagination and uploads
- [STORY-0419] Signal-based state store pattern

## Dependencies

- Blocks: [EPIC-06]
- Blocked by: [EPIC-01], [EPIC-03]

## References

- `docs/WHITEPAPER.md` §5.1–§5.15 (lines 6659–8324)
  - §5.1 Admin module tree (lines 6667–6759)
  - §5.2 Authentication endpoints (lines 6760–7080)
  - §5.3 `JwtAuthGuard` (lines 7081–7144)
  - §5.4 `nestjs-zod` DTO patterns (lines 7145–7249)
  - §5.5 Admin bucket endpoints (lines 7250–7353)
  - §5.6 Admin object browser endpoints (lines 7354–7451)
  - §5.7 Access-key management (lines 7452–7585)
  - §5.8 Initial admin bootstrap (lines 7586–7698)
  - §5.9 Audit logging (lines 7699–7746)
  - §5.10 Angular SPA structure (lines 7747–7825)
  - §5.11 Routing (lines 7826–7927)
  - §5.12 Auth state — `AuthService` and HTTP interceptor (lines 7928–8068)
  - §5.13 API client integration (lines 8069–8162)
  - §5.14 Object browser UI (lines 8163–8272)
  - §5.15 State management — signals (lines 8273–8324)
- `docs/ARCHITECTURE.md` §2
- `docs/BACKEND-DESIGN.md` §4.1, §5, §6
