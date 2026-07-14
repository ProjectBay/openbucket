---
slug: our-backups-were-lying
title: 'Our backups were lying to us: what a restore drill caught before 1.0'
description: A pre-1.0 restore drill caught our v1 backups silently dropping version history and encryption config. What we fixed — and why you should drill yours.
authors: [openbucket]
tags: [backup, restore, post-mortem, data-safety, s3, self-hosted]
date: 2026-07-16
keywords:
  [
    test backup restore,
    backup restore drill,
    verify backups work,
    s3 backup fidelity,
    self-hosted object storage backup,
    restore testing best practices,
  ]
---

OpenBucket has had backup and restore for a while: hit one endpoint, get a
portable `.zip` of your whole instance, upload it later to rebuild. The e2e test
was green. The console button worked. We would have told you — honestly, in good
faith — that backups were done.

Then, on the road to 1.0, we ran a proper restore drill: back up a fully-loaded
instance and restore it into a **pristine, separate one**. The archive restored
"successfully" — and silently dropped object version history, and rewrote
encrypted objects to disk as **plaintext**. This is the post-mortem, and the
argument for why you should drill your own restores this week, whatever store
you use.

<!-- truncate -->

## Why we drilled at all

The backup test we already had did a round-trip: create objects, back up,
restore, check the keys and bytes match. It passed. But it restored **into the
same running instance** — the instance that still held every bucket's config,
its SQLite metadata, and its encryption key. Any state the restore failed to
rebuild was invisibly papered over by state that had never left.

That's not the question a backup exists to answer. The real question is: *the
data volume is gone, or you're migrating hosts — can this `.zip` alone rebuild
your instance?* Before calling the data path 1.0-ready, we wrote an e2e drill
that asks exactly that
([`backup-restore-fidelity.e2e-spec.ts`](https://github.com/ProjectBay/openbucket/blob/main/apps/openbucket-backend-e2e/src/backup-restore-fidelity.e2e-spec.ts)),
and it now runs in CI on every change.

## The drill

The setup is deliberately worst-case realistic:

1. **Spawn instance A** and load it with rich state: a versioning-enabled bucket
   holding **three versions** of the same key; an object with a custom
   `Content-Type`, user metadata, and tags; a bucket with **default SSE-S3
   encryption** holding a secret object (verified to be ciphertext on A's disk);
   plus lifecycle rules, a CORS config, and a bucket policy.
2. **Take a whole-instance backup** — the same endpoint you'd use:

   ```bash
   curl -sS http://localhost:9000/api/admin/backup \
     -H "Authorization: Bearer $ADMIN_JWT" \
     -o openbucket-snapshot.zip
   ```

3. **Spawn a pristine instance B** — new data directory, fresh migrations, and,
   crucially, a **different auto-generated SSE key** (the drill asserts A's and
   B's keys differ).
4. **Restore into B** and diff *everything* against A: bytes, metadata, tags,
   versioning status, version history, bucket config — and the raw blob files
   on B's disk.

   ```bash
   curl -sS -X POST http://localhost:9000/api/admin/restore \
     -H "Authorization: Bearer $ADMIN_JWT" \
     --data-binary @openbucket-snapshot.zip
   ```

## What it caught

Current object bytes, content types, user metadata, tags, and versioning status
all survived. The rest did not.

**The scary one: a silent encryption downgrade.** A backup archive contains
decrypted bytes (documented and by design — the target instance has a different
key). On restore, the v1 code recreated the bucket but **dropped its
default-encryption config** — so the object writer had no reason to encrypt, and
the restored blob landed on B's disk as plaintext. Every read still returned the
right bytes. Nothing errored. Nothing logged. You'd only notice if you opened
the blob file on disk — which is exactly what the drill does, grepping the raw
file for the secret marker string.

**Version history: gone.** A had three versions of `doc.txt`; B had one. The v1
manifest captured only the current pointer per key, so the entire prior history
— the thing versioning exists to protect — evaporated on restore.

**Lifecycle, CORS, and bucket policy: gone.** Expiration rules stopped firing,
browsers lost their CORS grants, and a bucket that had a policy came back with
none.

The drill also surfaced two unrelated S3 read-path gaps while we were asserting
fidelity — `HEAD` didn't emit stored `x-amz-meta-*` headers, and `GET`/`HEAD`
didn't honour `?versionId`. Both were fixed in the same release
([v0.1.0-alpha.20](https://github.com/ProjectBay/openbucket/blob/main/CHANGELOG.md)).
Drills have a way of paying twice.

## Why v1 got it wrong

Not carelessness — a framing error. The v1 backup captured what was **easy to
enumerate**: walk the buckets, walk the current objects, stream bytes plus the
obvious per-object metadata. That's a snapshot of what the instance *contains*.

But an instance isn't just its contents. It's also **configuration that shapes
future behavior** (default encryption, lifecycle, CORS, policy) and **history**
(prior versions). None of that shows up when you iterate "the objects", and a
same-instance round-trip test can't miss it — the live instance still supplies
it. The moment the restore target was genuinely empty, everything the manifest
didn't carry simply ceased to exist.

## The fix: manifest v2

The manifest now captures the full per-bucket config and, for versioned keys,
every stored version:

```ts
interface BackupManifest {
  version: 1 | 2;
  kind: 'bucket' | 'instance';
  createdAt: string;
  buckets: BackupBucketConfig[]; // v2: + encryption/lifecycle/cors/policy/tagging
  objects: BackupObject[];
  /** v2 only — full version history, oldest→newest per key. */
  objectVersions?: BackupVersion[];
}
```

Three design decisions mattered more than the fields themselves:

**Ordering: config before bytes.** On restore, each bucket's captured config is
applied **before** any object payload is written — encryption first, then
versioning, then lifecycle/CORS/policy. Because the encryption default exists by
the time bytes arrive, the object writer re-encrypts every restored blob **under
the target instance's own key**. The drill asserts this at the filesystem level:
B's blob is ciphertext under B's key, and still decrypts correctly on read.

**History is replayed, not copied.** Version entries are authored oldest→newest
per key, and the restore replays each write in order — delete markers landing in
their exact historical position — so the target rebuilds a real history with a
correct current pointer. Version IDs are regenerated on replay; the *history* is
what's preserved, not the identifiers.

**Additive fields only.** Every v2 field is optional, so **v1 archives still
restore** — they just fall back to the old behavior (current versions, no bucket
config). A backup format that invalidates existing backups would be its own kind
of data loss.

Full details are in the [backup and restore guide](/docs/guides/backup-and-restore)
— including the honest caveats: restore is a **reset**, not a merge, and
snapshot archives contain decrypted bytes, so handle them like the data itself
(see [securing OpenBucket](/docs/guides/securing-openbucket)).

## A backup is a claim; only a restore is a proof

Here's the part that matters even if you never touch OpenBucket. Our backups
"worked" for months by every signal we had: green tests, valid archives,
successful restore responses. The lie wasn't in any of those signals — it was in
what we never asked. **A backup is a claim about the future. Only a restore into
a genuinely empty environment turns it into a proof.**

So run the drill, whatever your stack — Postgres dumps, S3 bucket sync, VM
snapshots:

- Restore into a **pristine target**, never the system that made the backup.
- Diff **properties**, not just bytes: permissions, encryption at rest,
  retention/lifecycle rules, history, policies.
- Check the **storage layer directly** where security properties live — a
  plaintext-on-disk downgrade is invisible from the read path.
- **Automate it.** Ours is a CI test now; fidelity can't silently regress.

OpenBucket is still pre-1.0 and single-node by design — we won't promise you
distributed durability. What we can promise is that the restore path is proven
by a drill on every commit, not asserted by a changelog.

---

Found this useful? A star on
[GitHub](https://github.com/ProjectBay/openbucket) helps more people find
OpenBucket — and if you run your own restore drill and it catches something,
we'd genuinely love to hear the war story in
[Discussions](https://github.com/ProjectBay/openbucket/discussions).
