---
id: TASK-3612
title: Implement bucket and key admin commands
story: STORY-1201
status: backlog
type: implementation
size: M
---

## Description
Implement the `buckets` and `keys` command groups on top of the transport from
TASK-3611: `buckets ls|mb|rb` and `keys create --scope|list|revoke`. Each maps to
one admin-API operation, reuses the api-client DTO types for the request/response
shapes, and prints via the formatter from TASK-3614.

## Files to create / modify
- `libs/nestjs/src/cli/commands/buckets.ts` — new
- `libs/nestjs/src/cli/commands/keys.ts` — new
- `libs/nestjs/src/cli/index.ts` — modify (register the two command groups)

## Implementation notes
- Type-only DTO imports (erased at emit — no Angular runtime pulled in):
  `import type { ListBucketsResponseDto, CreateBucketDto, CreateKeyDto, CreatedKeyDto, KeySummaryDto } from '@openbucket/api-client';`
- Buckets:
  - `buckets ls` → `GET /api/admin/buckets` (`listBuckets`) → render `ListBucketsResponseDto`.
  - `buckets mb <name> [--versioning enabled|disabled] [--object-lock] [--region <r>]`
    → `POST /api/admin/buckets` (`createBucket`). Body must satisfy `CreateBucketSchema`
    (`.strict()`): `{ name, versioning='disabled', objectLock=false, region='us-east-1' }`.
    Validate `name` client-side against the same regex
    `^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$` for a fast, friendly error before the round-trip.
  - `buckets rb <name>` → `DELETE /api/admin/buckets/:name` (`deleteBucket`). Surface
    the server's 409 (non-empty bucket) as a clear message; do not add a client-side
    `--force` recursive delete (out of scope, avoids accidental mass-deletion).
- Keys:
  - `keys list` → `GET /api/admin/keys` (`listKeys`) → `KeySummaryDto[]`
    (columns: id, accessKeyId, label, role, disabled, scope summary, lastUsedAt).
  - `keys create --label <l> [--scope prefix:<bucket>/<prefix>]` → `POST /api/admin/keys`
    (`createKey`). Body is `CreateKeyDto { label, scope? }`. Parse the `--scope`
    shorthand into the `CreateKeyDtoScope` union the controller expects (absent
    scope ⇒ unscoped `root`-equivalent key; a scope ⇒ restricted `scoped` sub-key).
    Print the returned `CreatedKeyDto` including `secretAccessKey` **once**, with a
    one-line "store this now — it is not shown again" notice, mirroring the
    controller's "secret is surfaced exactly once" contract.
  - `keys revoke <id>` → `POST /api/admin/keys/:id/revoke` (`revokeKey`), the
    reversible disable (distinct from a hard delete). Map a `404` to
    "key <id> not found".
- Edge cases / security:
  - The printed `secretAccessKey` is the ONLY place a secret appears; it goes to
    stdout (data), never to a log line, and is suppressed from any error path.
  - Under `--json`, emit the raw DTO so the secret is still delivered exactly once
    but machine-readably; never persist it to a file automatically.
  - Validate `--scope` shape locally and reject malformed prefixes with a usage
    error rather than sending a body the DTO would 400 on.

## Acceptance criteria
- [ ] `buckets ls` lists buckets and `buckets mb <n>` then `buckets rb <n>` round-trips (create → visible in ls → delete → absent).
- [ ] `buckets mb "Bad_Name"` fails client-side with an S3-naming message and issues no request.
- [ ] `keys create --label ci` prints an `accessKeyId` + `secretAccessKey` once; a second `keys list` shows the key but not its secret.
- [ ] `keys create --label ci --scope prefix:reports/2026/` creates a `scoped` key whose `keys list` scope summary reflects the prefix.
- [ ] `keys revoke <id>` disables the key; `keys revoke bogus` exits non-zero with "not found".

## Test obligations
- Unit: covered by [TEST-1201] (arg parsing, scope shorthand, name validation)
- E2E: covered by [TEST-1201] (live create/list/revoke against the backend)
- Conformance: N/A

## Dependencies
- Blocked by: [TASK-3611], [TASK-3614]

## References
- `libs/nestjs/src/lib/admin/buckets/buckets-admin.controller.ts` — `listBuckets`/`createBucket`/`deleteBucket`
- `libs/nestjs/src/lib/admin/buckets/dto/create-bucket.dto.ts` — `CreateBucketSchema`, `BUCKET_NAME` regex
- `libs/nestjs/src/lib/admin/keys/keys-admin.controller.ts` — `listKeys`/`createKey`/`revokeKey`, "secret returned ONCE"
- `libs/api-client/src/lib/model/create-key-dto.ts`, `created-key-dto.ts`, `key-summary-dto.ts`, `list-buckets-response-dto.ts`
