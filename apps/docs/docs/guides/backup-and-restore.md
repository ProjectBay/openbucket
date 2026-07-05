---
title: Backup and restore
description: Take per-bucket and whole-instance .zip snapshots on demand or on a schedule, with retention and optional off-box push.
sidebar_position: 6
---

# Backup and restore

Snapshot everything (or one bucket) to a portable `.zip`, restore it later, and —
when you're ready — put the whole thing on a schedule with retention and an
optional push off-box. Start with a one-command manual snapshot.

## Back up now (the copy-paste version)

Download a whole-instance snapshot:

```bash
curl -sS http://localhost:9000/api/admin/backup \
  -H "Authorization: Bearer $ADMIN_JWT" \
  -o openbucket-snapshot.zip
```

Or just one bucket:

```bash
curl -sS http://localhost:9000/api/admin/buckets/acme-data/backup \
  -H "Authorization: Bearer $ADMIN_JWT" \
  -o acme-data.zip
```

That's a complete, self-describing archive — object bytes plus the metadata
needed to rebuild the bucket(s).

## In the console

Open **Backup & restore**. Click **Download** for a whole-instance snapshot, or
use a bucket's **Backup** action for a single-bucket `.zip`. Restore uploads the
archive back through the same page.

## Restore (this RESETS the target)

Restore uploads a `.zip` and rebuilds from it:

```bash
# Rebuild the whole instance from a snapshot
curl -sS -X POST http://localhost:9000/api/admin/restore \
  -H "Authorization: Bearer $ADMIN_JWT" \
  --data-binary @openbucket-snapshot.zip

# Rebuild a single bucket
curl -sS -X POST http://localhost:9000/api/admin/buckets/acme-data/restore \
  -H "Authorization: Bearer $ADMIN_JWT" \
  --data-binary @acme-data.zip
```

Both return a small JSON summary — `bucketsRestored` / `objectsRestored` for the
instance route, `objectsRestored` for the bucket route.

:::warning Restore is a reset, not a merge
Restoring the instance **resets the instance**; restoring a bucket **resets that
bucket** to exactly the snapshot's contents. It is not additive — anything not in
the archive is gone. Restore into a fresh instance, or be certain you mean to
overwrite.
:::

Uploads stream straight to disk (the global body parser is off on these routes),
so multi-hundred-megabyte archives don't buffer in memory. Restore is also
bounded by guard rails against a hostile archive: total bytes, per-entry bytes,
entry count, and manifest size are all capped (`RESTORE_MAX_TOTAL_BYTES`,
`RESTORE_MAX_ENTRY_BYTES`, `RESTORE_MAX_ENTRIES`, `RESTORE_MAX_MANIFEST_BYTES`).

## Scheduled backups

Turn on a background runner that writes snapshots on a cron or fixed interval,
prunes old ones by a retention policy, and optionally pushes each finished
snapshot to your replication target.

### Standalone (env)

```bash
OB_SCHEDULED_BACKUP_ENABLED=true
OB_SCHEDULED_BACKUP_SCOPE=instance          # or `buckets` (one .zip per bucket)
OB_SCHEDULED_BACKUP_CRON="0 3 * * *"        # 03:00 daily — XOR with INTERVAL_MINUTES
OB_SCHEDULED_BACKUP_KEEP_LAST=7             # keep the newest N (default 7)
OB_SCHEDULED_BACKUP_MAX_AGE_DAYS=30         # also keep anything younger (default 30)
OB_SCHEDULED_BACKUP_PUSH_TO_REPLICATION=false
# OB_SCHEDULED_BACKUP_DIR=/var/lib/openbucket/backups   # default <dataDir>/backups
# OB_SCHEDULED_BACKUP_INTERVAL_MINUTES=1440             # instead of a cron
```

### Embedded (`forRoot`)

```ts
OpenBucketModule.forRoot({
  dataDir: '/var/lib/openbucket',
  // ...rootCredentials, admin...
  backups: {
    scope: 'instance',      // or 'buckets'
    cron: '0 3 * * *',      // XOR intervalMinutes
    keepLast: 7,
    maxAgeDays: 30,
    pushToReplication: false,
    // dir: '/var/lib/openbucket/backups',  // default <dataDir>/backups
  },
});
```

Exactly one of `cron` / `intervalMinutes` must be set; the cron expression is
validated at boot, so a typo fails fast instead of silently never firing.

### Retention is a union

`keepLast` and `maxAgeDays` are combined with **OR**, not AND: a snapshot is
pruned only if it's both older than `maxAgeDays` **and** outside the newest
`keepLast`. In other words `keepLast` is a hard floor — you never drop below N
snapshots even if they're all ancient.

Each write is atomic (temp file, then rename) and guarded by a free-space check,
and only one snapshot ever runs at a time.

### Drive it from the API

```bash
# Redacted status — counts, timestamps, and policy (never the snapshot dir)
curl -sS http://localhost:9000/api/admin/backup/schedule \
  -H "Authorization: Bearer $ADMIN_JWT"

# Trigger a snapshot now (202); a concurrent call joins the in-flight run
curl -sS -X POST http://localhost:9000/api/admin/backup/schedule/run-now \
  -H "Authorization: Bearer $ADMIN_JWT"
```

`run-now` shares the same code path and in-flight lock as the scheduled tick, so
it can never launch a second overlapping snapshot — a concurrent request returns
`{ "started": false }`.

## Push snapshots off-box

Set `pushToReplication` (env `OB_SCHEDULED_BACKUP_PUSH_TO_REPLICATION=true`) to
copy each finished snapshot to your configured [replication
target](./replication-and-tiering.md) under a reserved prefix — so a lost data
volume doesn't take your backups with it.

:::note Enable replication first
If you set the push flag but replication is off, the runner logs a boot-time
warning and writes snapshots locally only — the push is a no-op until you
configure `OB_REPLICATION_*`.
:::

:::warning Snapshots are plaintext
A `.zip` contains **decrypted** object bytes (SSE-S3 is a rest-encryption of the
local blobs, not the archive). Snapshots are written `0o600` inside a `0o700`
directory, but the archive itself inherits your data volume's trust boundary —
store and transfer it accordingly.
:::

## Next steps

- [Replication and tiering](./replication-and-tiering.md) — the off-box target the push uses.
- [Securing OpenBucket](./securing-openbucket.md) — protect secrets, snapshots, and the admin surface.
- [Multi-tenancy](./multi-tenancy.md) — scoped keys and admin roles.
