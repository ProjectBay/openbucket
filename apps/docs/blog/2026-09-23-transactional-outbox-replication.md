---
slug: transactional-outbox-replication
title: Replicating an object store with a transactional outbox
description: How OpenBucket mirrors every PUT and DELETE to an S3 remote — same-transaction outbox rows, per-key ordering, coalescing, backoff, and dead-lettering.
authors: [openbucket]
tags: [replication, architecture, durability, s3, self-hosted, deep-dive]
date: 2026-09-23
keywords:
  [
    transactional outbox pattern,
    s3 replication self-hosted,
    object storage replication,
    outbox pattern example,
    exponential backoff dead letter,
    replicate objects to s3,
  ]
draft: true
---

The transactional outbox is a well-worn pattern for messages: instead of
publishing to a broker inside a request, you write an "intent" row in the same
database transaction as your business data, and a background worker delivers it
later. Atomic with the commit, durable across crashes, retried until done.

OpenBucket applies the same pattern to something chunkier: **replicating blobs**.
Every object mutation on a single-node store gets mirrored, asynchronously, to
any S3-compatible remote — AWS S3, Cloudflare R2, Backblaze B2, a MinIO box in
another rack. Blobs are not messages, though, and the differences (ordering,
overwrites, multi-gigabyte payloads, hour-long remote outages) are exactly where
the design gets interesting. This post walks the implementation as it ships.

<!-- truncate -->

## Why the naive version is broken

The obvious implementation of "mirror every write" is a dual-write: commit the
object locally, then call `PutObject` on the remote before returning.

That has two failure modes, and both are bad. If the remote call is synchronous,
every upload now pays a WAN round-trip and inherits the remote's availability —
your local store is down whenever your mirror is. If you fire-and-forget instead,
you get the classic lost-mirror-on-crash: the process dies between the local
commit and the remote send, and that object is silently never replicated. No
record that a send was ever owed, so nothing to retry. You find out when you need
the mirror — which is the one moment it must not have holes.

The fix is to make "this object owes the remote a send" a durable fact, written
atomically with the object itself.

## Enqueue in the same transaction

OpenBucket's write path is a two-phase writer: the blob is staged and renamed
into place on disk, then the metadata row is committed in SQLite. The replication
intent is persisted **inside that same metadata transaction** — the enqueue seam
joins the caller's open `EntityManager` rather than forking its own:

```ts
// object-writer.service.ts — inside the PUT transaction, before em.commit()
this.outbox?.enqueue(em, {
  bucket,
  key: cmd.key,
  op: 'PUT',
  versionId: row.currentVersionId,
  etag: row.etag,
  size: row.size,
  contentType: row.contentType,
});

await em.commit();
```

The same seam runs on multipart-upload completion and on the delete paths, which
enqueue `op: 'DELETE'` intents on the delete's transaction. The consequence is
the whole point of the pattern: the intent commits **if and only if** the write
commits. A crash a microsecond after `em.commit()` loses nothing — the intent is
already on disk. A rollback takes the intent with it, so the outbox never
describes an object that doesn't exist.

The enqueue itself is synchronous and does no I/O beyond one extra INSERT on the
hot path — and when replication is disabled it's a no-op, so a local-only
deployment pays nothing.

## The drain worker, and what "durable" buys you

A background runner ticks every 5 seconds (`OPENBUCKET_REPLICATION_DRAIN_INTERVAL_MS`)
and asks one bounded question: which distinct `(bucket, key)` pairs have a due
pending intent? It takes up to 50 keys per tick (`OPENBUCKET_REPLICATION_BATCH_KEYS`),
oldest first, and drains them in parallel — distinct keys are independent, so
cross-key fan-out is safe, and the batch size also bounds how many file
descriptors and sockets are ever in flight at once.

Because intents live in the database, **boot resume is free**. There is no
in-memory queue to reconstruct and no "inflight" state to recover: the first tick
after a restart simply picks up every due pending row. A crash mid-send leaves
the intent pending, and it's retried — which is safe because both operations are
idempotent: a PUT converges the remote key to the same bytes, and a DELETE that
finds the remote key already gone counts as success.

For large payloads the worker streams: objects above a 64 MiB threshold
(`OPENBUCKET_REPLICATION_LARGE_OBJECT_THRESHOLD_BYTES`) go to the remote as a
multipart upload rather than a single PUT.

## Per-key ordering, not global ordering

Message-outbox implementations often chase total ordering. For blob replication
that's unnecessary — whether `a.jpg` or `b.jpg` mirrors first is irrelevant —
but **per-key** ordering is essential. If a client PUTs a key and then DELETEs
it, replaying those in the wrong order resurrects a deleted object on the remote.

OpenBucket gets per-key order from two cheap pieces. The write path already
serializes same-key writes behind a per-key lock, so a key's intents are enqueued
in write order; a process-monotonic sequence number (derived from the wall clock,
bumped on collision — no autoincrement round-trip) makes that order durable. The
worker then reads a key's pending chain strictly in sequence order, while
different keys proceed in parallel. Order where it matters, concurrency
everywhere else.

## Coalescing: only the last write matters

Here's where blobs diverge from messages for real. A message queue must deliver
every message. A mirror only has to converge on the **current** state — if a key
was overwritten five times while the remote was slow, replaying all five PUTs is
pure waste, potentially gigabytes of it.

So the worker coalesces with last-writer-wins semantics: it loads the key's
pending chain, acts only on the **last** intent, and marks every earlier one as
superseded up front. `PUT, PUT, PUT` collapses to one PUT of the latest bytes;
`PUT, DELETE` collapses to one DELETE. One edge case falls out naturally: if the
worker picks up a PUT intent whose object has since been deleted locally, the
send is a no-op success — the DELETE intent behind it in the chain carries the
real state. Once the send succeeds, the superseded rows are deleted so the outbox
table stays small.

The enqueue side stays deliberately dumb — it always appends, never dedupes.
Coalescing is entirely the reader's job, which keeps the write path at exactly
one INSERT.

## Backoff, dead-lettering, and the multi-hour outage

Failures back off exponentially with full jitter:
`min(1s × 2^(attempts−1), 5min) × rand(0.5..1.5)` — real constants from the
runner (`BACKOFF_BASE_MS = 1_000`, `BACKOFF_CAP_MS = 5 × 60_000`). After
`OPENBUCKET_REPLICATION_MAX_ATTEMPTS` failures (default **12**), an intent
dead-letters to `failed` and stops retrying, so one un-replicable object can't
occupy the worker forever.

It's worth doing the honest arithmetic on that: twelve attempts at those backoffs
give an intent roughly 10–30 minutes of retry budget (jitter-dependent). During a
**multi-hour** remote outage, then, the store itself is fine — writes keep
landing locally and keep enqueueing durable intents — but intents born early in
the outage will exhaust their attempts and dead-letter. Nothing is lost: they sit
visibly in `failed`, and when the remote returns, the admin **Reconcile** action
diffs local objects against the target and re-enqueues whatever is missing, as a
single-flight, bounded backfill. If your remote is routinely flaky for hours,
raising the attempts cap buys a longer window; reconcile is the backstop either
way.

## Watching it work

Replication you can't observe is replication you don't trust. The read model
aggregates the outbox with a single GROUP BY — it never materializes the queue —
and surfaces it in three places:

- the admin console's **Replication** page (depth, lag, last error, per-bucket
  breakdown, and the Reconcile button),
- `GET /api/admin/replication/status`, and
- the CLI: `openbucket replication status` prints enabled/pending/inflight/failed
  counters, the age of the oldest pending intent, the last error, and a
  per-bucket table (`--json` for scripts).

"Inflight" here means pending intents that have been attempted at least once —
i.e. currently in a backoff cycle. The Prometheus endpoint also exports outbox
depth, so you can alert on a growing backlog; see the
[observability guide](/docs/guides/observability). One deliberate redaction rule
throughout: the remote endpoint and credentials never appear in status output,
job errors, or the audit log.

## What this is not

Worth saying plainly: this is **disaster-recovery-grade mirroring, not high
availability**. Replication is asynchronous and one-way, so your RPO is nonzero —
whatever is in the outbox when the disk dies hasn't reached the remote yet.
There is no failover: the remote is a durable copy you'd restore from, not a
standby that starts serving traffic, and not a read replica. OpenBucket stays a
single-node, single-writer store by design; if you need multi-node quorum
storage, this isn't that, and we'd rather tell you so.

What it does answer is the first question every self-hoster asks about a
single-node object store — *what happens when the disk dies?* — with: your
objects are on real S3, at most seconds to minutes behind. Setup is a handful of
env vars; the [replication and tiering guide](/docs/guides/replication-and-tiering)
has the copy-paste version, plus the cold-tiering half of the story.

---

If you enjoy this kind of design writeup, a ⭐ on
[GitHub](https://github.com/ProjectBay/openbucket) is the best way to tell us to
write more of them. Poking holes in the failure-mode analysis is even better —
[Discussions](https://github.com/ProjectBay/openbucket/discussions) is open.
