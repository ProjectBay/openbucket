---
id: STORY-1201
title: openbucket CLI for admin operations
epic: EPIC-13
status: backlog
size: M
risk: low
---

## User story
As an operator, I want a small `openbucket` CLI that logs in with admin
credentials and runs bucket / key / backup / replication admin operations over
the admin API, so that I can script and troubleshoot a running instance without
hand-rolling `curl` + JWT juggling or opening the console.

## Description
Ship an `openbucket` command as a `bin` of `@openbucket/nestjs` (compiled to
`src/cli/`, shebang `#!/usr/bin/env node`). It authenticates against
`POST /api/admin/auth/login` to obtain a short-lived access token, then exposes
`buckets ls|mb|rb`, `keys create --scope|list|revoke`, `backup create|restore`,
and `replication status`. Endpoint and credentials come from flags or env; the
password is never taken on `argv` (only via `$OPENBUCKET_PASSWORD` or a
non-echoing prompt). The CLI reuses the generated api-client's DTO **types**
(plain interfaces under `libs/api-client/src/lib/model/`) via type-only imports
and a tiny `fetch`-based transport — the generated **services** are
`typescript-angular` (Angular DI + rxjs) and cannot run in a plain Node process,
so they are deliberately not instantiated. Output is friendly (aligned tables or
`--json`); any error exits non-zero with a redacted message.

## Acceptance criteria
- [ ] `openbucket buckets ls` prints the buckets returned by `GET /api/admin/buckets` (operationId `listBuckets`) and exits `0`; `buckets mb <name> [--versioning enabled] [--object-lock] [--region r]` calls `createBucket`; `buckets rb <name>` calls `deleteBucket`.
- [ ] `openbucket keys create --label <l> [--scope prefix:<bucket>/<pfx>]` calls `createKey` and prints the `secretAccessKey` **exactly once** (matching the controller's "surfaced once" contract); `keys list` calls `listKeys`; `keys revoke <id>` calls `revokeKey` (`POST /api/admin/keys/:id/revoke`).
- [ ] `openbucket backup create [--bucket <b>] -o <file.zip>` streams the zip from `GET /api/admin/backup` (or `/buckets/:name/backup`) to disk; `openbucket backup restore -f <file.zip> [--bucket <b>] --yes` uploads the raw zip to `POST /api/admin/restore` (or `/buckets/:name/restore`) and refuses to run without `--yes` (restore RESETS the target).
- [ ] `openbucket replication status` prints the payload from `GET /api/admin/replication/status` (operationId `getReplicationStatus`), succeeding even when replication is unconfigured.
- [ ] Config resolves from flags (`--endpoint`, `--username`) or env (`OPENBUCKET_ENDPOINT`, `OPENBUCKET_USERNAME`, `OPENBUCKET_PASSWORD`, `OPENBUCKET_TOKEN`); the password is **never** read from `argv`; the interactive prompt does not echo and is skipped when stdin is not a TTY (env/token must be supplied instead).
- [ ] Every HTTP failure exits non-zero with a one-line stderr message; a `401` reads "invalid credentials", a `429` reads "rate limited — retry after N s" (no retry storm), and no token / secret / password value ever appears in normal or `--json` output or in an error.
- [ ] `--json` emits machine-readable JSON to stdout and nothing else; `--help` / `openbucket <cmd> --help` print usage and exit `0`.
- [ ] `libs/nestjs/package.json` gains a `bin` entry (`"openbucket": "./src/cli/index.js"`); `nx build nestjs` compiles the CLI; the CLI adds **no** new runtime dependency (Node built-ins only), so the 3-place native-dep externalization rule is untouched.

## Tasks
- [TASK-3610] Scaffold the openbucket CLI entry, config resolution, and bin wiring
- [TASK-3611] Implement the fetch transport, login/JWT session, and secret-safe prompt
- [TASK-3612] Implement bucket and key admin commands
- [TASK-3613] Implement backup and replication commands
- [TASK-3614] Implement output formatting, exit codes, and error mapping

## Test plan
- [TEST-1201] openbucket CLI admin operations end-to-end

## Dependencies
- Blocks: —
- Blocked by: [STORY-0403] (admin login), [STORY-0411] (admin keys), [STORY-0902] (replication admin), backup & restore (`admin/backup/`, EPIC-08), [STORY-0500] (OpenAPI client generation — provides the DTO types)

## References
- `libs/nestjs/package.json` — add `bin` (currently no `bin` field; `files` already ships `src`)
- `libs/nestjs/src/lib/admin/auth/auth.controller.ts` — `POST api/admin/auth/login`, `@Throttle({ login: { limit: 5, ttl: 60_000 } })`, returns `LoginResponseDto { accessToken, expiresIn }`
- `libs/nestjs/src/lib/admin/buckets/buckets-admin.controller.ts` — `listBuckets` / `createBucket` / `deleteBucket`; `libs/nestjs/src/lib/admin/buckets/dto/create-bucket.dto.ts` (`CreateBucketSchema`)
- `libs/nestjs/src/lib/admin/keys/keys-admin.controller.ts` — `listKeys` / `createKey` / `revokeKey`; secret "surfaced exactly once (on create and on rotate)"
- `libs/nestjs/src/lib/admin/backup/backup.controller.ts` — `@ApiExcludeController` binary zip stream endpoints (not in the api-client)
- `libs/nestjs/src/lib/admin/replication/replication-admin.controller.ts` — `getReplicationStatus`
- `libs/api-client/src/lib/model/login-dto.ts`, `login-response-dto.ts`, `create-bucket-dto.ts`, `create-key-dto.ts`, `key-summary-dto.ts`, `bucket-replication-status-dto.ts` — plain-interface DTOs reused type-only
- Interfaces consumed: `LoginDto`, `LoginResponseDto`, `CreateBucketDto`, `CreateKeyDto`, `KeySummaryDto`, `ListBucketsResponseDto`, `BucketReplicationStatusDto` (from `@openbucket/api-client`, type-only)
- Interfaces produced: `openbucket` bin; `runCli(argv): Promise<number>` in `libs/nestjs/src/cli/index.ts`
