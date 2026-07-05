---
id: TASK-3613
title: Implement backup and replication commands
story: STORY-1201
status: backlog
type: implementation
size: M
---

## Description
Implement `backup create|restore` and `replication status`. Backup endpoints are
binary `.zip` streams excluded from the OpenAPI document, so these call the admin
API directly through the transport's streaming helpers rather than any generated
service. Restore is destructive (it RESETS the target), so it is gated behind an
explicit `--yes`.

## Files to create / modify
- `libs/nestjs/src/cli/commands/backup.ts` — new
- `libs/nestjs/src/cli/commands/replication.ts` — new
- `libs/nestjs/src/cli/http-client.ts` — modify (add/confirm `download()` + `upload()` stream helpers)
- `libs/nestjs/src/cli/index.ts` — modify (register the two command groups)

## Implementation notes
- Backup (binary, `@ApiExcludeController` — NOT in the api-client, so hand-rolled):
  - `backup create [--bucket <b>] -o <file.zip>` →
    `GET /api/admin/backup` (whole instance) or `GET /api/admin/buckets/:name/backup`
    (single bucket). Pipe `res.body` (a web `ReadableStream`) to a file via
    `Readable.fromWeb(res.body).pipe(createWriteStream(out))` — never buffer the
    archive in memory. Default `-o` to `openbucket-backup-<ts>.zip` /
    `<bucket>-backup-<ts>.zip`. Refuse to overwrite an existing file unless `--force`.
  - `backup restore -f <file.zip> [--bucket <b>] --yes` →
    `POST /api/admin/restore` or `POST /api/admin/buckets/:name/restore`. Stream the
    file as the raw request body (the controller reads the raw request stream; the
    global body parser is off). Set `Content-Type: application/zip` and, when known,
    `Content-Length`. Print the returned `{ bucketsRestored, objectsRestored }`
    (or `{ objectsRestored }` for a single bucket).
  - `--yes` gate: restore RESETS the instance/bucket. Without `--yes`, exit
    non-zero with a warning and issue NO request. Do not add an interactive
    "type the bucket name" confirm — keep it non-TTY-safe (CI supplies `--yes`).
- Replication:
  - `replication status` → `GET /api/admin/replication/status` (`getReplicationStatus`)
    → render `BucketReplicationStatusDto` (import type-only). Always succeeds, even
    when replication is unconfigured (`enabled:false`, zeroed counters) — do not
    treat "disabled" as an error exit.
  - (Trigger/`reconcile` is intentionally out of scope for v1 of the CLI to keep
    surface small; status is read-only and the common operator need.)
- Edge cases / security:
  - No remote replication endpoint or credential is ever surfaced (the controller
    never returns them; the CLI must not synthesize/print them either).
  - Handle a mid-stream HTTP error (non-2xx before/at body start) by deleting the
    partially-written output file so a truncated `.zip` is never left behind.
  - Cap nothing client-side on upload size (the server spools to disk); just stream.
  - Bearer token is attached by the transport; ensure it is not logged when
    `--json`/`--quiet` echo request metadata.

## Acceptance criteria
- [ ] `backup create -o /tmp/all.zip` writes a non-empty, valid `.zip`; `backup create --bucket b -o /tmp/b.zip` writes a single-bucket archive.
- [ ] `backup restore -f /tmp/all.zip` without `--yes` exits non-zero and sends no request; with `--yes` it restores and prints the counts.
- [ ] A server error during `backup create` leaves no partial output file on disk.
- [ ] `replication status` prints the status and exits `0` even when replication is disabled.
- [ ] No replication endpoint/credential and no bearer token appear anywhere in output.

## Test obligations
- Unit: covered by [TEST-1201] (`--yes` gate, partial-file cleanup, output-path defaults)
- E2E: covered by [TEST-1201] (create→restore round-trip + status against the backend)
- Conformance: N/A

## Dependencies
- Blocked by: [TASK-3611], [TASK-3614]

## References
- `libs/nestjs/src/lib/admin/backup/backup.controller.ts` — `GET backup`, `POST restore`, `GET/POST buckets/:name/(backup|restore)`, `@ApiExcludeController`
- `libs/nestjs/src/lib/admin/backup/backup.service.ts` — `streamInstanceBackup` / `restoreInstance` / `streamBucketBackup` / `restoreBucket`
- `libs/nestjs/src/lib/admin/replication/replication-admin.controller.ts` — `getReplicationStatus`
- `libs/api-client/src/lib/model/bucket-replication-status-dto.ts`
