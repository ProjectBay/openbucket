---
slug: detecting-bit-rot
title: Detecting bit rot before your users do
description: How OpenBucket's background scrubber catches silent disk corruption — SHA-256 at write time, byte-budgeted re-hashing, and digest-verified self-repair.
authors: [openbucket]
tags: [bit-rot, data-integrity, durability, s3, self-hosted, engineering]
date: 2026-10-07
draft: true
keywords:
  [
    detect bit rot,
    silent data corruption,
    object storage integrity check,
    sha256 checksum verification,
    data scrubbing,
    self-hosted s3 durability,
    self healing storage,
  ]
---

Here's an uncomfortable question for anyone running storage: **when was the last
time your system re-read a file it wrote a year ago?** For most setups the honest
answer is *never*. Bytes go in, sit on a disk for months, and the first entity to
read them back is the user who needs them — which means the user is also your
corruption detector. By then the file has probably aged out of every backup you
keep.

This post is an engineering deep-dive into how OpenBucket's background integrity
scrubber works: recording a SHA-256 for every object at write time, re-hashing
blobs in the background without starving live traffic, and — when a replica
exists — repairing corruption automatically. Even if you never run OpenBucket,
the design constraints generalize to whatever storage you do run.

<!-- truncate -->

## "The disk will tell me" is false comfort

Bit rot is the slow, silent corruption of data at rest — a flipped bit from a
failing sector, a firmware bug, a bad cable, a botched RAID rebuild. The
dangerous cases are precisely the ones nothing reports: the drive returns bytes
it believes are fine, and they aren't.

Filesystems mostly won't save you here. The common production defaults on Linux
checksum their own **metadata**, not your file contents — a silently corrupted
data block in a blob is returned to the application without complaint.
Filesystems that do checksum data end-to-end (ZFS, Btrfs) exist, but most
deployments — and nearly every Docker volume, VPS disk, and homelab — don't run
them. If the storage layer can't vouch for your bytes, the application layer has
to.

## Design: hash on write, re-hash forever

OpenBucket computes and stores a whole-object **SHA-256 over the plaintext
bytes** (`contentSha256`) for every object at write time — before any SSE-S3
encryption, so one digest validates single-part and multipart objects alike.
That digest already backs a read-time gate: a full `GET` re-hashes the blob as
it streams and returns a `500` on mismatch rather than serve corrupted bytes.

But the read gate only protects objects somebody reads. The
**background scrubber** closes the gap: on a scheduled tick it walks current,
local objects in keyset-paginated batches, streams each blob through the *same*
verifier the read gate uses (decrypting SSE-S3 first, so it's always hashing
plaintext), and compares the result to the stored digest. Sharing one verifier
is deliberate — two hashing implementations would eventually drift, and a
scrubber that computes a different digest than the write path is a false-alarm
generator.

## Throttling is the hard part

Writing a loop that re-hashes every file is an afternoon of work. Writing one
you can run **next to production traffic** is the actual engineering problem: a
naive scrubber saturates disk I/O re-reading terabytes, and your p99 latency
pays for it.

OpenBucket's scrubber is throttled on three axes, straight from the code:

- **A per-tick object cap** (`OPENBUCKET_INTEGRITY_SCRUB_MAX_OBJECTS_PER_TICK`,
  default 1,000) bounds the work per tick regardless of blob sizes.
- **A per-tick byte budget** (`OPENBUCKET_INTEGRITY_SCRUB_MAX_BYTES_PER_TICK`,
  default 1 GiB) bounds disk-read amplification — the verifier reports exactly
  how many plaintext bytes it hashed, and the tick is charged for them. The
  budget is checked *before* hashing each object; the moment either limit is
  hit, the tick stops and persists a durable resume cursor, so the next tick
  (default: every 60 seconds) picks up exactly where this one left off — across
  restarts too.
- **A `setImmediate` yield between batches**, so request handlers interleave
  with the scan instead of waiting behind it, and a scheduler guard that skips
  a tick rather than let slow ones pile up.

One more throttle worth calling out: the scrubber is **off by default**. A
fresh install performs zero extra disk reads and zero extra DB writes until you
opt in with `OPENBUCKET_INTEGRITY_SCRUB_ENABLED=true`. Background I/O you didn't
ask for is a bug, not a feature.

Robustness details matter as much as budgets. The cursor always advances even
when a single object errors, so one poisoned key can't wedge the whole walk. A
blob deleted mid-scan (`ENOENT`) is left `unchecked`, never flagged `corrupt`.
And a digest mismatch triggers a re-read of the object's *current* stored hash
first — if the object was overwritten mid-walk, that's a stale comparison, not
corruption.

## Verdicts you can actually see

Every scrubbed object carries a verdict: `unchecked` → `ok` or `corrupt`, with
a timestamp and a bounded, URL-redacted diagnostic. The admin console's
**Integrity** page (with a corrupt-count badge in the sidebar) and the
`/api/admin/integrity` API expose:

- `GET /api/admin/integrity/status` — enabled flag, lifetime scanned/repaired
  counters, live ok/corrupt/unchecked counts, last-run time, and the resume
  cursor,
- `GET /api/admin/integrity/corrupt` — the paginated corrupt-object list,
- `POST /api/admin/integrity/scrub` — a manual "scrub now" trigger that runs a
  one-shot pass on the next tick (even when the schedule is disabled) but never
  bypasses the budgets.

For alerting, two Prometheus gauges do the job:
`openbucket_integrity_objects{status="corrupt"}` above zero should page
someone, and a stale `openbucket_integrity_last_run_timestamp` means the
scrubber stopped making progress. See the
[observability guide](/docs/guides/observability) for the full metrics table.

## Self-healing — with a paranoid ordering

Detection alone leaves you with a list of broken files. When a
[replication target](/docs/guides/replication-and-tiering) is configured
(OpenBucket asynchronously mirrors every committed write to an S3-compatible
remote), a `corrupt` verdict triggers repair — and the ordering here is the
whole point:

1. **Fetch the remote copy first.** A missing remote key fails the repair
   without ever touching the local blob.
2. **Hard-link the corrupt local blob aside** as a zero-copy backup before any
   rewrite.
3. **Stage the remote bytes through the same two-phase writer** as every normal
   PUT — write to a temp file, `fsync`, atomic `rename` — with a size cap
   against a divergent remote object, re-encrypting to the original SSE form.
4. **Re-read the just-written on-disk bytes and verify them against the stored
   SHA-256 before the repair is accepted.** Only a digest match commits the
   repair and flips the row back to `ok`.

If that final check fails — the remote copy is *also* bad — the hard-linked
original is restored and the row stays `corrupt`. Why so paranoid? Because a
repair path that trusts its source can make things worse: replication is
asynchronous, remotes can diverge, and remote bytes can rot too. Verifying the
digest before committing the swap guarantees repair is monotonic — it can fix a
blob or leave it exactly as found, never replace recoverable-maybe bytes with
confidently wrong ones.

## And when there's no replica?

Then you get **detection and alerting only** — the row is marked `corrupt`, the
metric fires, and restoring the object from a
[backup snapshot](/docs/guides/backup-and-restore) is on you. That's an honest
limitation, not a footnote: OpenBucket is pre-1.0, single-node by design, and a
scrubber cannot conjure good bytes from a disk that lost them. What it buys you
is *time* — you find out while last month's backup still has the file, instead
of a year later when it doesn't.

All the knobs live in the [configuration reference](/docs/reference/configuration),
and the [durability page](/docs/concepts/durability) covers how scrubbing fits
next to atomic writes, replication, and backups.

## Scrub whatever you run

The transferable lesson has nothing to do with OpenBucket: **storage you never
re-read is storage you're merely hoping about.** If your stack records checksums
(S3 checksums, ZFS, a `sha256` column next to your uploads), schedule something
that actually verifies them. If it doesn't, even a nightly cron that re-hashes a
rotating slice of files against a manifest beats nothing — you'll find rot while
your backups still cover it. Just throttle it: budget the bytes, persist a
cursor, and never let the janitor outrun the tenants.

---

If you're the kind of person who reads to the end of a post about re-hashing
files, we'd love to have you around — a ⭐ on
[GitHub](https://github.com/ProjectBay/openbucket) helps more than you'd think,
and if you've fought bit rot in production, tell us the war story in
[Discussions](https://github.com/ProjectBay/openbucket/discussions).
