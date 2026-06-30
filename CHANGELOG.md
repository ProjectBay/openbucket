# Changelog

All notable changes to OpenBucket are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and the `@openbucket/nestjs` package follows
[Semantic Versioning](https://semver.org/spec/v2.0.0.html). Until 1.0.0, minor
versions may include breaking changes.

## [Unreleased]

_Nothing yet._

## [0.1.0-alpha.1] — 2026-06-30

First public pre-release of OpenBucket, published to the npm `next` dist-tag
(`npm i @openbucket/nestjs@next`). The S3 surface and admin console are
feature-complete and tested; APIs may still change before 1.0.

### Added

- **Embeddable library** `@openbucket/nestjs`: `OpenBucketModule.forRoot()` /
  `forRootAsync()` mount the S3 wire protocol, admin API, and bundled admin SPA
  under a configurable `mountPath`, isolated under their own MikroORM context so
  they coexist with a host app's database. An injectable `OpenBucketService`
  facade drives the store in-process.
- **S3 wire protocol**: path-style addressing, SigV4 (header + presigned),
  streaming PUT/GET, multipart uploads, bucket/object tagging, versioning, object
  lock (governance/compliance retention + legal hold), SSE-S3 at-rest encryption,
  lifecycle expiration, CORS, bucket policies, and S3-style XML errors.
- **Admin**: a JSON admin API (argon2id + rotating JWTs) and an Angular admin
  console, including a bucket **Object Lock** editor (enable + governance/compliance
  default retention).
- **Standalone** Docker deployment (point any S3 SDK at it).
- **Documentation site** (Docusaurus) published to GitHub Pages at
  <https://projectbay.github.io/openbucket/>.
- Open-source project scaffolding: README, LICENSE (MIT), CONTRIBUTING, Code of
  Conduct, security policy, changelog, issue/PR templates, Dependabot, CodeQL, CI.

### Fixed

- Hashed Angular assets are now served with a 1-year `immutable` cache instead of
  `max-age=300` (the cache regex didn't match Angular v21's `name-HASH.ext`
  naming), in both the standalone app and the published library.

### Removed

- Dropped a dead `objects.signal-store.ts` scaffold stub from the frontend.

[Unreleased]: https://github.com/ProjectBay/openbucket/compare/nestjs-v0.1.0-alpha.1...HEAD
[0.1.0-alpha.1]: https://github.com/ProjectBay/openbucket/releases/tag/nestjs-v0.1.0-alpha.1
