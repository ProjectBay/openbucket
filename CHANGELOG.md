# Changelog

All notable changes to OpenBucket are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and the `@openbucket/nestjs` package follows
[Semantic Versioning](https://semver.org/spec/v2.0.0.html). Until 1.0.0, minor
versions may include breaking changes.

## [Unreleased]

### Added

- **Embeddable library** `@openbucket/nestjs`: `OpenBucketModule.forRoot()` /
  `forRootAsync()` mount the S3 wire protocol, admin API, and bundled admin SPA
  under a configurable `mountPath`, isolated under their own MikroORM context so
  they coexist with a host app's database.
- **Admin console** bucket **Object Lock** editor (enable + governance/compliance
  default retention).
- Open-source project scaffolding: README, LICENSE (MIT), CONTRIBUTING, Code of
  Conduct, security policy, changelog, issue/PR templates, Dependabot, CodeQL.

### Fixed

- Hashed Angular assets are now served with a 1-year `immutable` cache instead of
  `max-age=300` (the cache regex didn't match Angular v21's `name-HASH.ext`
  naming), in both the standalone app and the published library.

### Removed

- Dropped a dead `objects.signal-store.ts` scaffold stub from the frontend.

## [0.1.0] — unreleased

Initial public release of OpenBucket.

- S3 wire protocol: path-style addressing, SigV4 (header + presigned), streaming
  PUT/GET, multipart uploads, bucket/object tagging, versioning, object lock
  (retention + legal hold), SSE-S3 at-rest encryption, lifecycle expiration,
  CORS, bucket policies, S3-style XML errors.
- Admin JSON API (argon2id + rotating JWTs) and Angular admin console.
- Standalone Docker deployment and the `@openbucket/nestjs` library.

[Unreleased]: https://github.com/ProjectBay/openbucket/compare/main...HEAD
