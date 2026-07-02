# OpenBucket testing patterns (EPIC-06 / §5.20)

Three canonical test levels. When a Test Plan in another Epic needs a pattern,
copy the named exemplar below rather than re-deriving fixtures, env wiring, or
ORM lifecycle.

> **Note on §5.20.1/§5.20.2:** the white-paper printed verbatim unit/e2e samples
> against a `BucketEntity` + in-process-`AppModule` shape that this repo does not
> use (the entity is `Bucket`; the e2e harness spawns the *built* app as a child
> process). Rather than land samples that don't compile, the canonical exemplars
> here are the **real, passing** specs already in the tree. The conformance
> sample (§5.20.3) had no pre-existing equivalent, so it is landed new.

## 1. Unit — service against in-memory SQLite

**Exemplar:** `apps/openbucket-backend/src/domain/buckets/bucket.service.spec.ts`

- Boot MikroORM against `:memory:` **per suite** — do **not** mock the
  `EntityManager` (see `BACKEND-DESIGN.md` §7.1). The real ORM catches schema,
  serialization, and transaction bugs a mock would hide.
- `createSchema()` in `beforeEach`/`beforeAll`; `orm.close(true)` after.
- Run: `nx test openbucket-backend --testPathPatterns=<spec>` (Jest 30 flag is
  plural `--testPathPatterns`).
- Runs on **Node 20** (historical; the persistence driver is now libsql, whose N-API binding is ABI-stable across Node majors) — see the repo's persistence
  note.

## 2. E2E — the built app as a spawned process

**Exemplars:** `apps/openbucket-backend-e2e/src/*.e2e-spec.ts` (e.g.
`auth-login.e2e-spec.ts` for the admin auth flow; `cors-preflight.e2e-spec.ts`
for an S3 slice) via the shared harness `apps/openbucket-backend-e2e/src/support/spawn-app.ts`.

- The harness `spawnApp(port)` runs the **webpack-built** `dist/.../main.js` as a
  child process with a format-valid env (`mkdtempSync` `DATA_DIR`, an argon2id
  `ADMIN_PASSWORD_HASH`, `JWT_SECRET`, root keys) — i.e. it exercises the real
  boot path, migrations, and HTTP server, not an in-process `Test` module.
- Each spec binds its own port; sign S3 requests with `aws4`, admin requests with
  the JWT from `/api/admin/auth/login`.
- Cold-boot stdout flake on Windows: verify readiness by health-polling, and a
  boot-timeout streak usually means stray processes — see the repo notes.
- Run: `nx e2e openbucket-backend-e2e --testPathPatterns=<name>`.

## 3. Conformance — real S3 clients against the running image

**Exemplar:** `apps/conformance/src/object-roundtrip.conformance.ts`

- Boot the built Docker image via `testcontainers`, point `@aws-sdk/client-s3`
  (path-style) at the mapped port, wait on `GET /api/admin/health` → 200, then
  exercise the S3 surface (the sample round-trips a 4 MiB object and asserts the
  ETag).
- Spec suffix is `.conformance.ts` so it never runs under the unit (`*.spec.ts`)
  or e2e (`*.e2e-spec.ts`) globs; the `conformance` project's `e2e` target runs it.
- Requires a running **Docker daemon** and the `openbucket:local` image (or set
  `OPENBUCKET_IMAGE`). The CI `conformance` job builds the image, loads it, and
  sets `OPENBUCKET_IMAGE`; the aws-cli/mc/s3cmd CLI matrix is owned by STORY-0504.
- Run: `nx run conformance:e2e --testPathPatterns=object-roundtrip`.
