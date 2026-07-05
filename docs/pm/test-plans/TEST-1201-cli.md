---
id: TEST-1201
title: openbucket CLI admin operations end-to-end
covers: [STORY-1201, TASK-3610, TASK-3611, TASK-3612, TASK-3613, TASK-3614]
status: backlog
level: e2e
---

## Goal
Verify the `openbucket` CLI authenticates and drives every admin operation
(bucket/key/backup/replication) against a real running instance, resolves config
from flags/env without ever taking a password on `argv`, returns correct exit
codes, and never leaks a token, JWT, password, or `secretAccessKey` on any error
path. Plus targeted unit coverage of the pure helpers (arg parsing, config
precedence, redaction, exit-code mapping).

## Setup
- Build the library so the `bin` exists: `nx build nestjs` → run the CLI as
  `node dist/libs/nestjs/src/cli/index.js <args>` (or `npm link` the built package
  and use `openbucket`).
- Spawn the standalone backend against a temp SQLite DB (reuse the
  `openbucket-backend-e2e` harness pattern), with a known `ADMIN_PASSWORD_HASH` +
  `JWT_SECRET`, listening on `http://127.0.0.1:<port>`.
- Export `OPENBUCKET_ENDPOINT=http://127.0.0.1:<port>`, `OPENBUCKET_USERNAME=admin`,
  `OPENBUCKET_PASSWORD=<pw>` for the happy-path cases; unset `OPENBUCKET_PASSWORD`
  for the non-TTY guard case.
- A temp dir for backup `.zip` artifacts.

## Cases
1. **Login via env** — given `OPENBUCKET_PASSWORD` set, when `openbucket buckets ls` runs, then it exits `0` and prints the (initially empty) bucket table; no password appears in the process argv captured via `/proc` or a wrapper.
2. **Login via token** — given `OPENBUCKET_TOKEN=<valid jwt>` and no password, when any read command runs, then no `/api/admin/auth/login` request is made (assert via server access log) and it exits `0`.
3. **Bucket lifecycle** — `buckets mb ci-bucket --versioning enabled` exits `0`; `buckets ls` shows `ci-bucket`; `buckets rb ci-bucket` exits `0`; a following `buckets ls` omits it.
4. **Bucket name validation** — `buckets mb "Bad_Name"` exits `2` (usage), prints an S3-naming message to stderr, and the server logs show no `POST /api/admin/buckets`.
5. **Key create + once-only secret** — `keys create --label ci` exits `0` and prints `accessKeyId` + `secretAccessKey`; capture the secret; `keys list` shows the key but the secret string does not reappear.
6. **Scoped key** — `keys create --label scoped --scope prefix:reports/2026/` creates a key whose `keys list` row shows role `scoped` and the prefix scope summary.
7. **Key revoke** — `keys revoke <id>` exits `0` and `keys list` shows it disabled; `keys revoke bogus-id` exits non-zero with "not found".
8. **Backup round-trip** — `backup create -o $TMP/all.zip` writes a valid, non-empty zip (verify the central-directory signature); `backup restore -f $TMP/all.zip --yes` exits `0` and prints restore counts.
9. **Restore guard** — `backup restore -f $TMP/all.zip` (no `--yes`) exits non-zero, prints a RESET warning, and the server logs show no `POST /api/admin/restore`.
10. **Partial-download cleanup** — point `backup create` at an endpoint that 500s mid-stream (fault-injected); assert the output path does not exist afterward.
11. **Replication status** — with replication unconfigured, `replication status` exits `0` and prints `enabled: false` with zeroed counters (not an error).
12. **Rate limit** — issue 6 rapid bad logins; the 6th exits `4`, the message mentions rate limiting, and exactly one login request is sent per invocation (no retry storm) — assert against the server's throttle log.
13. **Bad credentials** — wrong password → exit `3`, stderr reads "invalid credentials", and the output contains no token/password substring.
14. **Non-TTY guard** — no TTY, no `OPENBUCKET_PASSWORD`/`OPENBUCKET_TOKEN`: the CLI exits non-zero promptly (does not hang) with an instruction to set the env var.
15. **`--json` purity** — `buckets ls --json` emits a single JSON document parseable by `jq` with no table/notice lines on stdout.
16. **Redaction (unit)** — feed `CliError.toStderr()` a message embedding `Bearer eyJ...`, a JWT, and a `secretAccessKey`; assert all three are stripped.
17. **Config precedence + help (unit)** — `resolveConfig` honours flag > env; `--help`/`--version` exit `0`; unknown command exits `2`.

## Tooling
- Framework: jest + child_process (spawn the built CLI); supertest/fetch to seed/inspect the backend; `jq` for JSON assertions.
- Runner: `nx e2e openbucket-backend-e2e` (CLI-against-backend cases) and `nx test nestjs` (unit cases for `args`/`config`/`errors`/`output`).

## Pass criteria
- [ ] All 17 cases pass in CI.
- [ ] No case observes a token, JWT, password, or `secretAccessKey` on any stderr/error output.
- [ ] Exit codes match the TASK-3614 map (0 / 2 / 3 / 4) for their respective cases.
- [ ] `nx build nestjs` produces `dist/libs/nestjs/src/cli/index.js` with an executable shebang and the CLI adds no new runtime dependency.

## References
- `libs/nestjs/src/lib/admin/auth/auth.controller.ts` (login throttle 5/60s)
- `libs/nestjs/src/lib/admin/buckets/buckets-admin.controller.ts`, `keys/keys-admin.controller.ts`
- `libs/nestjs/src/lib/admin/backup/backup.controller.ts`, `replication/replication-admin.controller.ts`
- `apps/openbucket-backend-e2e/` (spawn-the-backend harness pattern)
