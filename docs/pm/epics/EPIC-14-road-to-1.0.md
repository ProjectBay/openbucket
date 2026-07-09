---
id: EPIC-14
title: Road to 1.0 (release readiness)
status: ready
whitepaper_section: "cross-cutting"
owner_area: backend
---

## Objective

Earn the right to tag `v1.0.0`. A 1.0 of a data store makes two promises to the
world: **(1) the public API is stable enough to build on** (semver from here), and
**(2) your data is safe with us**. The feature surface is already complete and
tested; what's missing before 1.0 is the *evidence* for promise (2) and the
*deliberate commitment* of promise (1). This Epic is the checklist that closes that
gap. It is explicitly gated on some real-world usage (see Sequencing): freezing an
API that no one has run in anger is the classic premature-1.0 mistake.

## The 1.0 exit bar (definition of done)

1. The public library surface (`OpenBucketService`, `OpenBucketModule` options, the
   `/multer` adapter) and the admin JSON API are **reviewed and frozen** under a
   written semver / deprecation policy.
2. The **release gate runs the full unit suite** (no skipped-because-flaky specs)
   and a **coverage threshold** is enforced.
3. The S3 compatibility matrix is backed by a **machine-generated, dated conformance
   report** (client × operation, image sha), not a hand-maintained table.
4. A **tested backup → upgrade → restore drill** exists and the on-disk format is
   declared stable; a disaster-recovery runbook is published.
5. The **new surface added since the July 2026 audit** (replication, tiering, scoped
   keys, `ADMIN_PASSWORD`) has had a focused security re-pass; the threat model
   (STRIDE) is published.
6. **Honest single-node benchmarks** and a **production checklist** are published.
7. A stable (non-prerelease) version sits on the npm `latest` tag and the
   `ghcr.io`/`docker.io` `latest` image tag.

## Scope — workstreams

### A. API stability (the defining work)
- **API-review pass** of every package export (`libs/nestjs/src/index.ts`, the
  `/multer` subpath), the module options (`open-bucket-options.ts`), and the service
  facade (`open-bucket.service.ts`). Settle naming, defaults, and types that would
  be painful to change post-freeze. (Recent churn to watch: `admin.passwordHash` →
  optional + `admin.password`.)
- **Admin API review** — endpoint/DTO shapes + the generated `libs/api-client`.
- Write an **API-stability & deprecation policy** doc (what semver covers).

### B. Provable correctness
- **De-flake the concurrency / blob-store specs** so `release-nestjs.yml` can stop
  skipping the unit suite. The release you tag 1.0 must pass its own full suite.
- **Machine-generated, dated conformance report** from `apps/conformance/` (feeds
  `reference/s3-compatibility.md`).
- **Coverage gate** — surface + enforce the number (CI already runs `--coverage`).

### C. Data-safety proof
- **Backup → upgrade → restore drill** as an automated test over a populated DB;
  assert forward-only migrations round-trip.
- Declare the **on-disk format stable**; document any format-version marker.
- **Disaster-recovery runbook** (restore-to-roll-back is the model).

### D. Security re-pass
- Focused audit of the surface added since EPIC-08: async replication + tiering
  (SSRF/credential handling), scoped-key policy evaluation, the new `ADMIN_PASSWORD`
  seed path, presigned POST.
- Publish the **threat model / STRIDE** doc (deferred from EPIC-08 as a spike).

### E. Honest expectations
- **Benchmarks**: single-node PUT/GET throughput at a few object sizes, stated
  hardware + methodology. Answers "is one node fast enough?".
- **Production checklist** doc (TLS proxy, backups on, replica configured, resource
  limits). Complements the existing "Is OpenBucket for you?" page.

### Out of scope (post-1.0)
- Multi-node / clustering / HA — explicitly *not* a 1.0 goal (single-node by design).
- New auth mechanisms (OIDC, full IAM policy language).

## Sequencing / dependencies

- **Launch + gather real usage runs in parallel and gates workstream A.** Do not
  freeze the API (the irreversible step) until a handful of real deployments have
  exercised it — real usage is the only reliable source of "we'd regret this shape".
- B (correctness) and C (durability) can proceed immediately and independently.
- D (security re-pass) should follow A/C so it audits the frozen surface.
- E (benchmarks/checklist) is independent; do it whenever.
- The final step is purely mechanical: cut a non-prerelease tag → the existing
  release workflows promote `latest` on npm + the registries automatically.
