---
slug: what-it-takes-to-call-a-data-store-1-0
title: What it takes to call a data store 1.0
description: For a data store, 1.0 is two promises — a stable API and safe data — and both demand evidence. OpenBucket's exit bar, published so you can hold us to it.
authors: [openbucket]
tags: [release-engineering, reliability, s3, self-hosted, open-source]
date: 2026-10-14
keywords:
  [
    when to release 1.0 open source,
    semantic versioning data store,
    s3 compatible object storage stability,
    backup restore testing strategy,
    software release readiness checklist,
    api stability policy,
  ]
draft: true
---

For most software, 1.0 is a marketing decision. Bump the number when the landing
page looks good, when a conference is coming up, when the team needs a morale win.
Nobody gets hurt: if a to-do app breaks an API, users grumble and update a few call
sites.

A data store doesn't get that luxury. When you tag 1.0 on something that holds
other people's bytes, you are making exactly two promises: **the API is stable
enough to build on** (real semver from here on), and **your data is safe with
us**. Both promises are cheap to make and expensive to keep — which is why neither
should be backed by confidence. They should be backed by evidence. This post is
OpenBucket's public definition of that evidence: the exit bar we have to clear
before `v1.0.0` exists, published so anyone can hold us to it.

<!-- truncate -->

## Confidence is not evidence

Every maintainer *feels* ready before they *are* ready. We shipped the full S3
surface — versioning, object lock, multipart, lifecycle, encryption, bucket
policies — months ago, and it's tested. By vibes alone, OpenBucket could have been
"1.0" in the summer.

But "the tests pass" and "the feature list is long" are statements about effort,
not about the two promises. Evidence for promise one looks like a reviewed, frozen
surface under a written policy. Evidence for promise two looks like a restore
drill that actually ran, on a populated instance, and either passed or told you
something ugly. (Ours told us something ugly. More on that below.)

So here is the bar, item by item — partly as a status report, partly because these
are principles any project shipping a data store could steal.

## The exit bar

### 1. A reviewed, frozen public surface — under a written policy

Semver only means something if you've decided what the "public API" *is*. Before
freezing, every export gets an API-review pass: the `OpenBucketService` facade,
the `OpenBucketModule` options, the `/multer` adapter, the admin JSON API and its
generated client. Naming, defaults, and types that would be painful to change
post-freeze get settled now, and the result ships with a written semver and
deprecation policy — a document, not a vibe.

The prep work is underway and visible in the changelog: composition-root
internals moved out of the package root into a `/standalone` subpath so the main
entry only exposes what we intend to support; three near-identical upload-result
types were unified onto one shape; and the standalone env vars were consolidated
onto a single `OPENBUCKET_` prefix — a deliberately breaking rename we made *now*
because pre-1.0 is the last cheap moment to fix inconsistent names. The freeze
itself has not happened yet, for a reason covered at the end of this post.

### 2. A release gate that runs the full suite — no flaky-skips

Every project accumulates a quiet shame: the specs that are skipped in CI because
they're "flaky." Ours were the concurrency and blob-store specs — exactly the
tests you most want passing in an object store. For a while the npm release
workflow skipped the unit suite around them.

That's fixed: the quarantined concurrency, request-id, and scheduled-backup specs
were de-flaked, and the release gate now runs the **full** unit suite. The
remaining piece is surfacing and enforcing a coverage threshold (CI already
collects coverage; the number needs to become a gate). The principle: **the
release you tag 1.0 must pass its own complete test suite.** If a test is too
flaky to run, it's too flaky to trust — fix it or admit the feature isn't done.

### 3. A machine-generated conformance report, not a hand-maintained table

Hand-maintained compatibility tables rot the day after they're written. Since
alpha.19, the S3 conformance suite emits a **machine-generated, dated report** —
client × operation — which feeds the
[S3 compatibility reference](/docs/reference/s3-compatibility). If the AWS CLI,
the JS SDK, or boto3 stops working against some operation, the report says so
with a date on it, rather than a table quietly claiming last quarter's truth.

### 4. A restore drill you actually ran — and what ours caught

This is the item that turns "your data is safe" from a slogan into evidence: an
automated **backup → upgrade → restore** drill over a populated instance, plus a
declared-stable on-disk format and a disaster-recovery runbook.

We ran the drill (backup a loaded instance, restore into a fresh one, diff
everything), and it earned its keep immediately: the v1 backup manifest was
**silently dropping prior object versions, per-bucket default encryption,
lifecycle rules, CORS, and bucket policies**. Worst of all, restored objects in
encrypted buckets came back *unencrypted at rest* — a silent security downgrade
no unit test had flagged. Manifest v2 (alpha.20) fixes all of it: full version
history is replayed in order, and per-bucket config is applied *before* object
bytes are written, so restores re-encrypt under the new instance's key. Old v1
archives still restore.

The lesson generalizes: **a backup you haven't restored is a hypothesis.** The
formal on-disk-format declaration and the published DR runbook are still ahead of
us; the drill that justifies them already exists and lives in CI. Details in the
[backup & restore guide](/docs/guides/backup-and-restore).

### 5. A security re-pass of everything added since the last audit

OpenBucket went through an external white-box audit in July 2026 — 22 confirmed
findings, all remediated in alpha.8 (the write-up is
[public](/docs/concepts/security-audit-2026)). But an audit is a snapshot, and
we've shipped a lot since: async replication and tiering (remote credentials,
SSRF surface), scoped-key policy evaluation, presigned POST, and the new
plaintext `ADMIN_PASSWORD` seed path. Before 1.0, that post-audit surface gets a
focused security re-pass, and the threat model (STRIDE) — deferred from the
original audit — gets published. A 2026 audit badge doesn't cover 2026's code
unless someone re-checks the delta.

### 6. Honest numbers and honest expectations

Two documents remain that are less glamorous than any feature: **single-node
benchmarks** (PUT/GET throughput at a few object sizes, with stated hardware and
methodology — answering "is one node fast enough for me?") and a **production
checklist** (TLS proxy in front, backups on, replication target configured,
resource limits). They complement the existing
[Is OpenBucket for you?](/docs/is-openbucket-for-you) page, which already says
plainly that this is a single-node store by design and points you elsewhere when
that's wrong for you. Numbers you'd rather not publish are exactly the ones a
1.0 owes its users.

### 7. The classic trap: freezing an API nobody has run in anger

Here's the item that gates everything else, and the reason this post isn't a 1.0
announcement. The most common premature-1.0 mistake isn't a missing test — it's
**freezing an API that only its authors have used**. Internal usage cannot tell
you which option name is confusing, which default is wrong, or which method
shape you'll regret, because the authors unconsciously route around every rough
edge.

So the API freeze — the one irreversible step — is explicitly gated on a handful
of real deployments exercising the surface first. Everything else (correctness,
durability, benchmarks) proceeds in parallel; the freeze waits for evidence only
strangers can generate. If you're running OpenBucket today, your bug reports and
"this option name confused me" comments are, quite literally, on the critical
path to 1.0.

## Where that leaves us

Done: the de-flaked full-suite release gate, the machine-generated conformance
report, the restore fidelity drill (and the manifest-v2 fix it forced), and the
freeze-prep API cleanup. Remaining: the coverage gate, the written semver policy
and the freeze itself, the format declaration and DR runbook, the security
re-pass and threat model, benchmarks, and the production checklist. The
up-to-date version of this list lives on the [roadmap](/docs/roadmap).

We're publishing the bar before clearing it on purpose. A checklist you grade
yourself on privately is worth little; one your users can quote back at you is a
commitment device. If we tag `v1.0.0` with any of the above missing, call it out
— publicly. And if you maintain a data store of your own, steal the bar. Adjust
the items, keep the principle: **1.0 is not a feeling. It's evidence.**

---

If you want to hold us to this, the best seats are a ⭐ on
[GitHub](https://github.com/ProjectBay/openbucket) — where the release gate,
conformance report, and restore drill are all public — and
[Discussions](https://github.com/ProjectBay/openbucket/discussions), where the
1.0 checklist gets argued about in the open. Running OpenBucket in a real
deployment? Tell us what the API got wrong *before* we freeze it.
