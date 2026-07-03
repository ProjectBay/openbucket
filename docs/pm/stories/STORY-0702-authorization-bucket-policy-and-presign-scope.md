---
id: STORY-0702
title: "Authorization enforcement: bucket policy & presign scope"
epic: EPIC-08
status: ready
size: L
risk: high
---

## User story
As an operator hardening a bucket, I want the bucket policy I attach (and the SigV4 signatures I rely on) to actually be enforced on the S3 request path, so that an explicit `Deny`, a `Condition` (TLS / source-IP), and the AWS host-binding contract are real controls rather than persisted-but-inert configuration.

## Description
Close the two authorization findings from the 2026-07-04 white-box audit. Finding [11] (CWE-862): the entire bucket-policy surface is inert — `SigV4Guard.canActivate` authenticates and stamps `req.openbucket.accessKeyId` (`sigv4.guard.ts:98`) but no guard, interceptor, or service ever loads or evaluates `bucket.policy`, so `Deny` statements and `Condition` clauses an operator attaches are silent no-ops while `PutBucketPolicy` returns 200 and `GetBucketPolicy` echoes the document (false assurance). Finding [8] (CWE-345): the `SignedHeaders` list is taken verbatim from the client and the server never requires `host` (nor every wire-present `x-amz-*` header) to be signed, a deviation from the AWS SigV4 contract that removes host-binding defense-in-depth. This Story adds a real policy evaluator invoked after signature verification (explicit-Deny > Allow > default-allow-for-root, with Action/Resource/Condition matching) and enforces mandatory-header coverage on both the header and presigned SigV4 paths.

## Acceptance criteria
- [ ] A bucket policy statement with `Effect: Deny`, `Action: s3:GetObject`, `Resource: arn:aws:s3:::<bucket>/*` blocks an otherwise-authenticated `GET /:bucket/:key` with `403 AccessDenied`; removing the statement restores `200`.
- [ ] An explicit `Deny` overrides an `Allow` for the same action/resource (deny-overrides), and default behavior with no matching statement remains allow for the single root credential (no regression to existing S3 operations).
- [ ] A `Condition` of `Bool { aws:SecureTransport: "false" }` under a `Deny` blocks plain-HTTP requests; a `Condition` of `IpAddress { aws:SourceIp: <cidr> }` scopes access to the configured network — both observable on the request path.
- [ ] The policy evaluator matches `Action` and `Resource` against the resolved `req.openbucket.operation` and bucket/key, mapping the S3 operation to its `s3:*` action name.
- [ ] A header-signed request whose `SignedHeaders` omits `host` is rejected (`SignatureDoesNotMatch`/`AccessDenied`), as is a presigned URL whose `X-Amz-SignedHeaders` omits `host`.
- [ ] A request carrying an `x-amz-*` header on the wire that is absent from `SignedHeaders` is rejected on both the header and presigned paths (case-insensitive).
- [ ] Compliant AWS SDK/CLI requests (which sign `host` and all `x-amz-*`) continue to pass unchanged — no conformance regression.

## Tasks
- [TASK-2120] Implement bucket-policy evaluation on the S3 request path
- [TASK-2121] Enforce SignedHeaders coverage of host and present x-amz-* headers

## Test plan
- [TEST-0702] Bucket-policy evaluation and SignedHeaders coverage

## Dependencies
- Blocks: (a hardened 0.1.x / 1.0 authorization story)
- Blocked by: [STORY-0700] — the critical unauthenticated admin-API bypass (P0 [TASK-2100], audit finding [1], CWE-178) must land first in a patch release; do not ship authorization hardening ahead of closing the fail-open auth boundary.

## References
- White-box security audit, 2026-07-04 — findings [11] (CWE-862, `access-control`) and [8] (CWE-345, `sigv4`).
- `libs/nestjs/src/lib/s3/sigv4/sigv4.guard.ts` (auth-only `canActivate`; `parseAuthorization`; accessKeyId stamped at :98)
- `libs/nestjs/src/lib/s3/sigv4/presigned.ts` (`verifyPresigned`, `X-Amz-SignedHeaders` parsed ~:74)
- `libs/nestjs/src/lib/s3/sigv4/canonical-request.ts` (`buildCanonicalRequest` folds only client-named headers, :29–34)
- `libs/nestjs/src/lib/domain/buckets/bucket.service.ts` (`getPolicy` :489, `putPolicy` :497, `getPolicyDoc` :739, `setPolicy` :746)
- `libs/nestjs/src/lib/persistence/entities/types.ts` (`PolicyDocument` :68–78)
- `docs/pm/S11-DECISIONS.md` #6 (bucket policies stored-but-not-evaluated — the deferral this Story now closes), `docs/ARCHITECTURE.md` §206, §216
- Interfaces consumed: `SigV4Guard`, `BucketService.getPolicyDoc`, `OpenBucketRequestContext.operation/accessKeyId` (`libs/nestjs/src/lib/common/types/request.d.ts`)
- Interfaces produced: a policy-evaluation guard/interceptor on the S3 controller tree; mandatory-header validation in `SigV4Guard.parseAuthorization` and `verifyPresigned`
