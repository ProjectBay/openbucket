# Glossary

Project terms used throughout the PM tree, ARCHITECTURE.md, and
WHITEPAPER.md. Definitions are normative — use these meanings in
artifact prose.

## Product

- **OpenBucket** — the project: a single-container, single-process,
  S3-compatible object store with an embedded admin UI.
- **Single-tenant** — exactly one admin user and one pair of root S3
  access keys per instance. Sub-keys are out of scope for v1.
- **MinIO parity** — feature target for the S3 surface: bucket+object
  CRUD, multipart, presigned URLs, copy, CORS, versioning, lifecycle,
  object locking, server-side encryption, tagging, basic bucket
  policies.

## S3 protocol

- **Bucket** — a namespace for objects. Globally unique within a
  single OpenBucket instance.
- **Key** — the path-like name of an object within a bucket. UTF-8,
  1–1024 bytes.
- **Object** — the addressable unit: bucket + key, with bytes plus
  metadata.
- **Version** — for a versioning-enabled bucket, every PUT creates a
  new immutable version identified by a server-issued version ID.
- **Delete marker** — a tombstone version that hides previous versions
  from default reads in a versioning-enabled bucket.
- **Multipart upload** — a session that uploads an object as a sequence
  of parts, each ≥ 5 MiB except the last, then composed via
  `CompleteMultipartUpload`.
- **Part** — a single chunk within a multipart upload, numbered 1..N.
- **Presigned URL** — a URL whose query string carries a SigV4
  signature, allowing a third party to PUT or GET without holding
  long-lived credentials.
- **SigV4** — AWS Signature Version 4. The signing protocol OpenBucket
  verifies in reverse on every S3 request.
- **Path-style addressing** — `GET /<bucket>/<key>`.
- **Virtual-host-style addressing** — `GET /<key>` with
  `Host: <bucket>.<endpoint>`.
- **ETag** — the entity tag returned with an object. Single-PUT ETag
  is the MD5 of the payload; multipart ETag is
  `MD5(concat(MD5(part_i)))-N`.

## Storage

- **DATA_DIR** — host-mounted volume root (default `/data` inside the
  container).
- **Path-mirror layout** — object bodies stored at
  `<DATA_DIR>/blobs/<bucket>/<encoded-key>`, one file per object.
- **Key encoding** — deterministic percent-encoding applied only at
  the filesystem boundary; SQLite holds the raw key.
- **Two-phase commit** — write-blob-then-commit-row sequence used by
  the storage layer to keep filesystem and SQLite consistent across
  crashes.
- **Orphan blob** — a file in `blobs/` with no matching row in
  `objects`. Reconciled (logged, not deleted) by the startup scan.
- **Trash** — directory holding lifecycle-pending deletions until
  their grace period expires.
- **Tmp** — scratch directory on the same filesystem as `blobs/`, used
  so `rename(2)` is atomic.

## Backend

- **Classifier middleware** — Express middleware that decides
  `req.openbucket.kind = 's3' | 'admin' | 'spa'` once per request.
- **Controller tree** — a group of Nest controllers under one routing
  prefix. OpenBucket has two: the S3 tree (catches everything not
  under admin or SPA) and the admin tree (`/api/admin/*`).
- **Domain service** — business-logic service consumed by both
  controller trees.
- **BlobStore** — the filesystem abstraction implementing
  `putBlob`/`getBlob`/`composeBlobs`/etc.
- **EM** — the MikroORM `EntityManager`. Per-request via
  `RequestContext`.

## Auth

- **Root access key** — the single pair of S3 credentials configured
  at boot; signs all S3 requests in v1.
- **Admin user** — the single human user able to log into the admin
  SPA. Password stored as argon2id hash.
- **Access token** — short-lived (15 m) JWT used in
  `Authorization: Bearer ...` for admin API calls.
- **Refresh token** — long-lived (7 d) opaque token in an HttpOnly
  cookie scoped to `/api/admin/auth`. Rotated on every use.
- **Token reuse** — using a refresh token whose `rotatedFrom` has
  already been redeemed. Triggers revocation of the chain.

## Process

- **Background tick** — an in-process scheduled task (lifecycle sweep,
  multipart cleanup, trash purge, orphan scan).
- **Conformance suite** — CI matrix exercising the built container
  with real S3 clients (aws-cli, mc, s3cmd).
- **Clock** — injectable abstraction wrapping `Date.now()`, with a
  test variant that advances on command via
  `/api/admin/_test/advance-clock` when `OPENBUCKET_TEST_MODE=1`.

## PM artifacts

- **Epic** — a section of the white paper, scoped to an owner area.
- **Story** — a vertically-sliced, independently shippable unit
  (1–3 engineer-days), with explicit acceptance criteria and at
  least one Test Plan.
- **Task** — a concrete code change, typically a file or a small
  tightly-related set.
- **Test Plan** — the verification strategy for one or more Stories
  / Tasks, at one of three levels: unit, e2e, conformance.
- **Spike** — a Task of type `spike` used to record an open question
  or required investigation. Always starts `blocked`.
