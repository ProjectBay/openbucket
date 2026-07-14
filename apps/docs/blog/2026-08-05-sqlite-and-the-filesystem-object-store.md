---
slug: sqlite-and-the-filesystem-object-store
title: SQLite + the filesystem is a perfectly good object store (for one node)
description: Why OpenBucket stores metadata in SQLite and blobs on the local filesystem — the atomic write path, the concurrency model, and where the ceiling really is.
authors: [openbucket]
tags: [architecture, sqlite, s3, self-hosted, durability, deep-dive]
date: 2026-08-05
keywords:
  [
    sqlite object storage,
    self-hosted s3 compatible,
    single node object store,
    minio alternative single node,
    atomic file writes fsync rename,
    object storage architecture,
    sqlite metadata store,
  ]
draft: true
---

OpenBucket stores object metadata in a single SQLite file and object bytes as
plain files on the local filesystem. When people hear that, the reaction tends to
split: half say "obviously, that's all most apps need," and the other half start
listing the ways it will fall over. Both halves are onto something.

This post is the honest version of the argument. Not "SQLite scales further than
you think" (true, but not the point), and not "you probably won't lose data"
(never say that). The claim is narrower: for a single node, a transactional
metadata store plus atomic filesystem writes is not a budget imitation of a
distributed object store — it's a different design with different trade-offs, and
for a large class of applications those trade-offs are the right ones. Here's what
the design actually looks like, mechanism by mechanism, including where the
ceiling is.

<!-- truncate -->

## The split: SQLite decides, the filesystem holds

Every object in OpenBucket lives in two places:

- **SQLite** holds the truth: one row per `(bucket, key)` with size, ETag, content
  type, user metadata, tags, lock state — and a stored SHA-256 of the plaintext
  bytes. Version history, multipart bookkeeping, access keys, lifecycle cursors,
  and the replication outbox are all rows in the same database.
- **The filesystem** holds the bytes: `DATA_DIR/blobs/<bucket>/<encoded-key>`,
  with S3 keys percent-encoded per path segment so arbitrary UTF-8 keys can't
  escape the tree or collide with filesystem quirks. Prior versions of a key sit
  next to it in a `<key>.v/<versionId>` directory.

The database is authoritative; the blob file is just the payload the row points
at. A `GET` never trusts the filesystem to know what exists — it asks SQLite,
then opens the file. That one rule is what makes crash recovery tractable, as
we'll see. (Full layout: [storage layout](/docs/concepts/storage-layout).)

## How a write actually lands

The core write path, straight from the code:

1. Stream the body into `DATA_DIR/tmp/put-<uuid>`, opened with `O_EXCL` so two
   writers can never share a staging file. MD5 (the future ETag) and SHA-256 are
   computed **on the same pass**, over plaintext, before any at-rest encryption.
2. `fsync` the temp file — the bytes are on the platter, not in the page cache.
3. `rename(2)` it to its final path. On one filesystem, rename is atomic: readers
   see the old file or the new one, never a torn half.
4. `fsync` the parent directory, so the rename itself survives power loss.
5. Commit the metadata row — pointer update, the version row if the bucket is
   versioned, and the replication intent — in **one SQLite transaction**.

The transaction commit is the linearization point. A crash before step 5 leaves
at most an orphan blob with no row pointing at it; a startup recovery scan
reconciles that (and cleans abandoned multipart staging) without ever guessing.
Overwrites get extra care: the current blob is hard-linked aside as a zero-copy
backup before the swap, restored if the commit fails, discarded if it succeeds.
A failed overwrite is a no-op, not a corrupted key.

SQLite itself runs in WAL mode with `synchronous = FULL`, so a committed
transaction is fsync'd before the write returns. None of this is exotic — it's
the same staging-plus-rename discipline Maildir and package managers have used
for decades. The point is that on a single filesystem, *the primitives for
atomic, durable writes already exist*. You don't need a consensus protocol to
get them; you need to actually call `fsync` in the right places.

## What SQLite buys that a directory of JSON files doesn't

The metadata store could have been flat files too — plenty of home-grown blob
stores do exactly that, and it's where they go wrong. A real database buys:

- **Multi-row atomicity.** A versioned PUT touches the pointer row, inserts a
  version row, and enqueues a replication intent. One transaction: all of it
  commits or none of it does. The replication outbox can never record a write
  that didn't happen, and a committed write can never miss its outbox entry.
- **Real queries.** `ListObjectsV2` is an indexed range scan with a computed
  upper bound — not a `LIKE 'prefix%'` that defeats the index, and not a
  `readdir` walk that falls over at a million keys.
- **One-file operations.** The entire metadata plane is `openbucket.db`. Backups,
  migrations (forward-only, run at boot), and "copy the volume somewhere safe"
  all stay boring.
- **Zero operational surface.** No connection pool, no server to patch, no
  credentials to rotate for a database nobody else connects to.

## "But SQLite has a single writer"

Yes — and that's fine, because there is exactly one process. OpenBucket's
[concurrency model](/docs/whitepaper/04-streaming-and-concurrency) is the
event loop, not threads. Writes to SQLite serialize; WAL readers proceed in
parallel and don't block behind writers. Blob I/O runs on libuv's thread pool,
so concurrent uploads to *different* keys stream in parallel with no shared
state — distinct temp files, distinct rename targets, distinct rows.

The interesting cases are the racy ones, and they resolve with POSIX semantics
rather than locks. Two clients PUT the same key concurrently? Both stage to
their own temp files; both renames are atomic; a per-key mutex in the writer
serializes the metadata commits, and the last committed transaction wins the
ETag — which is exactly S3's last-writer-wins contract. A `GET` racing a
`DELETE`? The reader already holds an open file descriptor; `unlink` removes the
directory entry but the inode survives until the descriptor closes, so the read
drains cleanly and the *next* one gets a 404. No tombstones, no reference
counting — the kernel already implements this.

## Where the ceiling genuinely is

Now the concessions, because they're real and they're the point:

- **This is a single point of failure for availability.** No clustering, no
  quorum, no failover. If the node is down, your store is down until it's back.
- **Scale is vertical.** One machine's disk, one metadata database. Tens of
  terabytes and high-concurrency multi-tenant workloads will outgrow it, and
  there is no shard button.
- **Durability is your disk and your fsync.** OpenBucket does its part of the
  contract; if the hardware lies about flushes, no software fixes that.

If any of those are disqualifying, use AWS S3, R2, or a MinIO cluster — the
[fit guide](/docs/is-openbucket-for-you) says this in the first paragraph, not
the footnotes.

What the durability features change is the *risk calculus*, not the availability
math. [Async replication](/docs/guides/replication-and-tiering) mirrors every
committed PUT and DELETE to a real S3-compatible target (S3, R2, B2, MinIO)
through that transactional outbox — surviving remote outages via retry and
resuming on boot. Every full `GET` re-hashes the stream against the stored
SHA-256 and refuses to serve corrupt bytes; an opt-in background scrubber hunts
bit-rot proactively and, when a replica exists, repairs a corrupt blob from the
known-good remote copy. [Scheduled backups](/docs/guides/backup-and-restore)
snapshot the whole instance — version history, encryption config, policies —
to a restorable archive, optionally pushed off-box. That's "one node, plus a
durable copy elsewhere, plus continuous integrity checking." It is not HA, and
we won't call it HA. For a lot of workloads — internal tools, single-region
SaaS, self-hosted products, edge boxes, air-gapped deployments — it's an honest
match for what the data actually needs. (The full mechanism-by-mechanism story:
[durability](/docs/concepts/durability).)

## Right-sized, not down-sized

The distributed alternative has costs people wave away: a cluster to operate,
erasure-coding parameters to understand, upgrade choreography, and a failure
surface where the storage system itself becomes the most complex thing you run.
Paying those costs makes sense when you need what they buy. Paying them by
default — for an app whose entire dataset fits on one NVMe drive — is cargo
culting, and "we might need to scale someday" is how you end up operating a
distributed system for a workload SQLite could have handled from a laptop.

One process, one database file, one directory tree, and a short list of rules
that make writes atomic. You can read the whole persistence design in an
afternoon and audit the write path in an hour. For one node, that's not the
compromise. That's the feature.

---

If this kind of design writing is useful, a ⭐ on
[GitHub](https://github.com/ProjectBay/openbucket) is the best way to signal we
should do more of it. Spotted a hole in the argument? We'd genuinely like to
hear it — open a thread in
[Discussions](https://github.com/ProjectBay/openbucket/discussions).
