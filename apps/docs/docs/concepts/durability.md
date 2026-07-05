---
title: Durability
description: How OpenBucket keeps your bytes correct — atomic writes, stored SHA-256 integrity gates, background scrubbing, replication, tiering, and backups.
sidebar_position: 3
---

# Durability

**What you'll learn:** the layers that keep a stored object exactly the bytes you
put — through crashes, power loss, and silent disk rot — and how to get a durable
copy off the box.

## The write path is atomic

OpenBucket never writes an object in place. Every blob write stages, syncs, and
renames:

```text
1. write bytes to  DATA_DIR/tmp/put-<uuid>   (O_EXCL, so two writers never collide)
2. fsync the temp file                        (the data is on the platter)
3. rename → DATA_DIR/blobs/<bucket>/<key>     (rename(2) is atomic on one filesystem)
4. fsync the parent directory                 (the rename itself is now durable)
```

A crash at any point leaves either the **old** object or the **new** one — never a
torn half-written blob. The same tmp→fsync→rename shape backs multipart parts,
multipart compose, backups, and rehydrated (tiered) reads.

:::warning[Keep `tmp/` and `blobs/` on one filesystem]
`rename(2)` is atomic **only within a single filesystem**. If `DATA_DIR/tmp` and
`DATA_DIR/blobs` land on different mounts, Node returns `EXDEV` and OpenBucket
falls back to a (non-atomic) copy + unlink, logging a loud warning. Mount all of
`DATA_DIR` as one volume — don't bind-mount subdirectories separately.
:::

## Overwrites are crash-safe

Overwriting a key is destructive-in-place by nature, so before the swap OpenBucket
**hard-links the current blob aside** as a backup (zero-copy — the old inode
survives). If the write or the metadata commit fails, it restores the backup; on
success it discards it. A crash mid-overwrite is reconciled by the **startup
recovery scan**, which also removes orphaned multipart staging directories and
reports (but never deletes) blobs with no matching metadata row.

## Metadata is durable too

Metadata lives in one SQLite file (`<DATA_DIR>/openbucket.db`) opened in **WAL
mode with `synchronous = FULL`**, so a committed transaction is fsync'd to the WAL
before the write returns. Replication intents are written in the **same
transaction** as the object metadata (a transactional outbox), so a committed PUT
can never be lost or orphaned by a rollback.

## Every object carries a SHA-256

On write, OpenBucket computes and stores two digests over the **plaintext** bytes
(before any SSE encryption): the MD5 that becomes the S3 `ETag`, and a
**SHA-256** (`contentSha256`). Because the hash is over plaintext, one digest
validates single-part and multipart objects alike.

### Read-time integrity gate

A full `GET` **re-hashes the blob as it streams** and compares it to the stored
SHA-256. On a mismatch OpenBucket returns a `500` rather than serve corrupted
bytes — bit-rot never reaches a client silently.

### Background integrity scrubbing

The read gate only catches objects someone reads. A **background scrubber**
proactively walks current, local objects, re-hashes each blob through the *same*
verifier as the read gate, and records a per-object verdict (`unchecked` →
`ok`/`corrupt`). It is **off by default** and strictly rate-limited — a hard
per-tick object cap **and** a per-tick byte budget, a resume cursor between ticks —
so it never starves request traffic.

```bash
# Enable the scrubber (standalone):
OB_INTEGRITY_SCRUB_ENABLED=true
OB_INTEGRITY_SCRUB_MAX_BYTES_PER_TICK=1073741824   # 1 GiB/tick (default)
```

When a blob is `corrupt` **and** a replication target is configured, the scrubber
**self-heals**: it fetches the good remote copy, stages it through the two-phase
writer, re-verifies the on-disk bytes against the stored SHA-256, and atomically
swaps it in — flipping the row back to `ok`. A remote copy that also fails the
digest is rolled back, never overwriting the local blob. The admin **Integrity**
page (and `/api/admin/integrity`) surfaces the scan summary, the corrupt-object
list, and a manual "scrub now" trigger.

## Replication: a durable off-box copy

Async **one-way** replication mirrors every committed PUT/DELETE to an external
S3-compatible target (AWS S3, Cloudflare R2, Backblaze B2, MinIO, or another
OpenBucket) via the transactional outbox. A background worker drains it with
**per-key ordering**, **last-writer-wins coalescing**, **exponential-backoff
retry**, and a **dead-letter cap**. Because intents are durable, the worker just
resumes on boot after a crash or a remote outage — local reads and writes keep
working while the remote is unreachable, and the backlog drains on recovery.

```bash
OB_REPLICATION_ENABLED=true
OB_REPLICATION_BUCKET=my-remote-mirror       # must already exist
OB_REPLICATION_ACCESS_KEY_ID=…
OB_REPLICATION_SECRET_ACCESS_KEY=…
# Omit OB_REPLICATION_ENDPOINT for real AWS S3; set it for R2/B2/MinIO.
```

:::note[Plaintext over the wire]
The worker sends object **plaintext** (SSE is decrypted before sending), so an
`http://` endpoint leaks object contents and warns at boot. Prefer `https://`
unless the target is MinIO on a trusted LAN. Credentials are never logged.
:::

The admin **Replication** page (and `/api/admin/replication`) shows pending/failed
depth and lag, and offers a bounded, single-flight **Reconcile** that re-enqueues
anything missing or size-divergent on the remote.

## Cold-object tiering (read-through)

Tiering reuses the replication target to **offload cold objects** and
**rehydrate them transparently on read**. A `<Transition>` rule (age since last
access + a `StorageClass`) drives a sweep that ships cold bytes remotely —
**only after confirming durability** — then soft-deletes the local blob. A later
`GET` fetches the bytes back, integrity-verifies them **before serving**, and
flips the row local again (large objects get a short-lived presigned redirect
instead of being proxied). There is **no data-loss window**: the local blob is
deleted only after the remote copy is confirmed, and a corrupt/truncated remote
yields a `500`, never bad data.

## Backups: point-in-time snapshots

Beyond the on-demand backup/restore endpoints, OpenBucket can write **`.zip`
snapshots on a schedule** and prune them by a retention policy:

```bash
OB_SCHEDULED_BACKUP_ENABLED=true
OB_SCHEDULED_BACKUP_SCOPE=instance           # or 'buckets' (one .zip per bucket)
OB_SCHEDULED_BACKUP_CRON='0 3 * * *'         # OR OB_SCHEDULED_BACKUP_INTERVAL_MINUTES
OB_SCHEDULED_BACKUP_KEEP_LAST=7              # retention floor
OB_SCHEDULED_BACKUP_MAX_AGE_DAYS=30          # union with keep-last
```

Each snapshot is written **atomically** (stream to `<final>.part`, fsync, rename)
so a crash never leaves a torn `.zip` masquerading as a good backup, with a
sidecar recording size, object count, and SHA-256. **Union retention** means
keep-last-N is a hard floor and max-age can never delete a fresh snapshot. A
pre-flight free-space guard skips a cycle rather than fill the disk.

:::warning[Snapshots contain plaintext object bytes]
A backup archive holds **decrypted** object bytes (same posture as replication),
so snapshot files are `0o600` under a `0o700` directory. Treat the backup volume
with the same trust boundary as `DATA_DIR`.
:::

## Next steps

- [Storage layout](./storage-layout.md) — where blobs, versions, trash, and the SQLite DB live.
- [Security model](./security-model.md) — SSE-S3 keys and secret handling.
- [Monitoring](../operations/monitoring.md) — watch replication lag and integrity counts in Prometheus.
- [Upgrading](../operations/upgrading.md) — always snapshot before you upgrade.
