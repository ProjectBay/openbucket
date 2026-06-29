---
id: EPIC-02
title: S3 wire protocol & SigV4 authentication
status: backlog
whitepaper_section: "§2"
owner_area: s3
---

## Objective

Implement the full S3-compatible surface that real clients (aws-cli,
mc, s3cmd, AWS SDKs) speak to OpenBucket: XML request/response
handling, SigV4 reverse-verify for both header-based and presigned-URL
signing, the complete operation route table (service, bucket, object,
multipart, CORS), the S3 error taxonomy with XML serialization, CORS
preflight, and ListObjectsV2 pagination with an HMAC-sealed
continuation token. This Epic owns the wire surface — it consumes the
bootstrap from EPIC-01, the storage layer from EPIC-03, the streaming
handlers from EPIC-04, and the `KeyService.getSecret` contract from
EPIC-03.

## Scope

- In scope:
  - S3 controller topology and dispatcher pattern.
  - Virtual-host vs path-style routing cooperating with the classifier middleware.
  - `XmlInterceptor` with `fast-xml-parser@4.4.x` for request parsing and response serialization.
  - `SigV4Guard` covering header-based and query-string-presigned variants.
  - Explicit rejection of `STREAMING-AWS4-HMAC-SHA256-PAYLOAD` with `InvalidArgument`.
  - Canonical-request builder and constant-time signature comparison.
  - Replay protection via `X-Amz-Date` window (±15 minutes).
  - `S3Error` class hierarchy plus the full XML exception filter body.
  - Exhaustive operation route table: Service, Bucket, Object, Multipart, Tagging/ACL/Policy, CORS, Versioning, Lifecycle, Object Lock, Encryption.
  - Per-bucket CORS preflight handling.
  - HMAC-sealed continuation token format for `ListObjectsV2`.
- Out of scope:
  - Nest bootstrap, classifier middleware itself, exception filter scaffolding — owned by EPIC-01.
  - MikroORM entities, BlobStore, key encoding, `KeyService` implementation — owned by EPIC-03.
  - Streaming the request body, range responses, multipart staging, background ticks — owned by EPIC-04.
  - Admin API, JWT, Angular SPA, Docker, CI — owned by EPIC-05 / EPIC-06.

## Success criteria

- `aws s3 cp` with header-based signing succeeds against the running server (with `--no-payload-signing` workaround documented for chunked uploads).
- `aws s3 presign` URLs verify and serve correctly.
- A malformed signature returns `403 SignatureDoesNotMatch` with the canonical S3 XML body.
- The full operation route table is wired and OPTIONS preflight returns the configured per-bucket CORS rules.
- ListObjectsV2 pagination returns a continuation token that decodes only with the server-side HMAC key.

## Stories

- [STORY-0100] S3 controller topology and dispatcher pattern
- [STORY-0101] RouteResolver for virtual-host vs path-style routing
- [STORY-0102] XML request/response handling
- [STORY-0103] SigV4 verification core (header-based) and canonical request
- [STORY-0104] Presigned URL verification
- [STORY-0105] S3Error class hierarchy and error taxonomy
- [STORY-0106] S3 XML exception filter
- [STORY-0107] Service-scope operations (ListBuckets)
- [STORY-0108] Bucket CRUD and listing operations
- [STORY-0109] Object CRUD operations
- [STORY-0110] Multipart upload operations
- [STORY-0111] Tagging, ACL, and Policy operations
- [STORY-0112] Bucket CORS configuration operations
- [STORY-0113] Bucket versioning operations
- [STORY-0114] Bucket lifecycle configuration operations
- [STORY-0115] Object lock configuration, retention, and legal hold
- [STORY-0116] Bucket encryption operations
- [STORY-0117] CORS preflight handling per bucket
- [STORY-0118] ListObjectsV2 pagination with HMAC-sealed continuation token

## Dependencies

- Blocks: [EPIC-06]
- Blocked by: [EPIC-01], [EPIC-03], [EPIC-04]

## References

- `docs/WHITEPAPER.md` §2 (lines 1052–2814)
  - §2.1 Topology of the S3 controller tree (lines 1068–1242)
  - §2.2 Virtual-host vs path-style routing (lines 1243–1325)
  - §2.3 XML request/response handling (lines 1326–1575)
  - §2.4 SigV4 verification (lines 1576–1984)
  - §2.5 Presigned URL verification (lines 1985–2132)
  - §2.6 S3 error taxonomy (lines 2133–2359)
  - §2.7 The S3 XML exception filter (lines 2360–2486)
  - §2.8 Operation route table (lines 2487–2584)
  - §2.9 CORS preflight handling (lines 2585–2688)
  - §2.10 ListObjectsV2 pagination (lines 2689–2814)
- `docs/ARCHITECTURE.md` §2, §4, §11
- `docs/BACKEND-DESIGN.md` §4.2
