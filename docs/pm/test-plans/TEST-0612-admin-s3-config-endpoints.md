---
id: TEST-0612
title: Admin S3-config endpoints — controller adapters, audit, OpenAPI/client freshness, e2e round-trip
covers: [STORY-0612, TASK-1858, TASK-1859, TASK-1860, TASK-1861, TASK-1862, TASK-1863, TASK-1864, TASK-1865, TASK-1866]
status: done
level: e2e
---

## Goal
Verify the new admin JSON endpoints are thin, correct adapters over the existing domain methods: each endpoint round-trips against the booted app, mutations emit the right audit events, bulk delete returns `{deleted, errors}`, the presigned URL verifies against the existing SigV4 verifier, and the OpenAPI export + regenerated client are collision-free and byte-equal (STORY-0500 gate).

## Setup
- Backend on **Node 20** (better-sqlite3 native ABI — per `[[project_node20_persistence]]`): run install/test/build on `node 20.18.0`, not the node-23 default.
- Unit layer: plain controller instances with hand-built mock `BucketService`/`ObjectService`/`AuditService` + a fake `req` ({ openbucket:{requestId}, user:{username} }) — no TestingModule (mirrors `buckets-admin.controller.spec.ts`).
- E2E layer: boot the real app (or NestApplication via supertest) with a temp `DATA_DIR`; seed a bucket + a few objects; authenticate with an admin JWT (the global `JwtAuthGuard` is not `@Public()`). Verify boot via health-poll, not the spawn stdout string (cold-boot flake, `[[project_e2e_boot_flake]]`).
- OpenAPI/client: `nx run openbucket-backend:openapi:export` (ts-node) + `nx run api-client:generate` (Docker `openapitools/openapi-generator-cli:v7.14.0`) + `nx run api-client:check`. Docker daemon required — if down, this layer is authored-not-verified per `[[project_m6_openapi_and_env]]`.

## Cases
1. (unit) Each new controller method calls the mapped domain method with the correct args and returns the expected JSON DTO (ISO dates, number sizes). [TASK-1866]
2. (unit) Every mutation emits `audit.emit` with the catalogued event + `subject` + `requestId`; every read emits nothing; error paths (NotFound/Malformed) propagate without emitting. [TASK-1864/1866]
3. (e2e) `POST :name/objects:batchDelete {keys:[{key:'a'},{key:'missing'}]}` → `{ deleted:[{key:'a'}], errors:[{key:'missing', code, message}] }`; one `object.deleted` audit per deleted key. [TASK-1858]
4. (e2e) Bucket config round-trips: PUT then GET versioning/tagging/encryption/lifecycle/cors/object-lock/policy each return what was written; GET on an unconfigured feature → the domain 404 (NoSuchTagSet / NoSuchCORSConfiguration / etc.); PUT encryption `aws:kms` → 400 ValidationFailed (not 422, per `[[project_admin_api_spec_drift]]`). [TASK-1859/1860]
5. (e2e) Object sub-resources: `GET …/objects/<slash/bearing/key>?versions` lists versions + delete markers on a versioned bucket; `?tagging` PUT/GET/DELETE round-trips; `?retention` + `?legal-hold` PUT/GET persist (retention 404 when unset, legal-hold defaults OFF). Key decoded exactly once. [TASK-1861/1862]
6. (e2e) `POST …/objects/<key>:presign {expiresIn:3600}` → `{url, expiresAt}`; the URL passes the real `verifyPresigned` AND a GET to that URL through the S3 surface returns the object bytes; `expiresIn > MAX_EXPIRES` capped/400. [TASK-1863]
7. (cli) `nx run openbucket-backend:openapi:export` lists every new operation with zero duplicate-operationId warnings (method-name-only `operationIdFactory`); `nx run api-client:generate` produces the new service methods + DTO models; `nx run api-client:check` exits 0 (byte-equal). [TASK-1864/1865]

## Tooling
- Framework: jest (unit) + supertest (e2e) + `@aws-sdk/client-s3` or a raw fetch to validate the presigned GET against the S3 surface.
- Runner: `nx test openbucket-backend --testPathPatterns=buckets-admin.controller.spec` / `--testPathPatterns=objects-admin.controller.spec` (plural flag — `[[project_jest30_testpathpatterns]]`); `nx run openbucket-backend:openapi:export`; `nx run api-client:check`. All on Node 20.

## Pass criteria
- [ ] Unit cases 1–2 pass (`nx test openbucket-backend`, Node 20).
- [ ] E2E cases 3–6 round-trip against the booted app (health-poll boot check).
- [ ] CLI case 7: OpenAPI export collision-free + `api-client:check` byte-equal (or recorded authored-not-verified if the Docker daemon is down, `[[project_m6_openapi_and_env]]`).
- [ ] Validation failures return **400 ValidationFailed** (not 422).

## References
- STORY-0612 and TASK-1858..1866.
- `apps/openbucket-backend/src/admin/{buckets,objects}/**`, `domain/buckets/bucket.service.ts`, `domain/objects/object.service.ts`, `s3/sigv4/presigned.ts`, `libs/api-client/**`.
- See `[[project_admin_api_spec_drift]]`, `[[project_node20_persistence]]`, `[[project_jest30_testpathpatterns]]`, `[[project_e2e_boot_flake]]`, `[[project_m6_openapi_and_env]]`.
