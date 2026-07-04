---
id: EPIC-10
title: Durability & cloud replication
status: backlog
whitepaper_section: "future — post-1.0 feature (extends §3, §4)"
owner_area: persistence
---

## Objective

Answer the single biggest question a self-hoster asks about a single-node,
local-filesystem object store: *"what happens when the disk dies?"* Having
hardened security (EPIC-08), this Epic hardens **durability** — the other half of
production trust — by letting OpenBucket asynchronously replicate to (and
optionally tier cold objects onto) an external S3-compatible target (AWS S3,
Cloudflare R2, Backblaze B2, another OpenBucket). Local-first speed, cloud-backed
durability, without giving up the single-process design.

## Scope

- In scope:
  - **Async replication** of object writes/deletes to one external S3-compatible
    target, with a durable outbox/queue, retry with backoff, and ordering per key.
    [STORY-0900]
  - **Cold-object tiering** — offload objects not accessed within a policy window
    to the remote, transparently fetching them back on read (or redirecting).
    [STORY-0901]
  - **Replication status & reconciliation** — admin visibility into lag, failures,
    and a reconcile/backfill job; surfaced in the console. [STORY-0902]
- Out of scope:
  - Synchronous/strongly-consistent multi-writer replication or clustering (breaks
    the single-process DNA — explicitly avoided).
  - Bi-directional sync / conflict resolution (one-way local→remote in v1).
  - Erasure coding / RAID-like local redundancy.

## Success criteria

- With a target configured, every successful object PUT/DELETE is durably enqueued
  and eventually applied to the remote; a killed process resumes the outbox on boot
  (no lost replication intents).
- Replication survives remote outages: intents retry with backoff and the local
  store keeps serving.
- A tiered (offloaded) object is transparently readable, fetched back from the
  remote on demand, within a bounded added latency.
- The admin console shows replication lag, last error, and offers a manual
  reconcile that backfills any objects missing on the remote.

## Stories

- [STORY-0900] Async replication to an external S3-compatible target (durable outbox) — tasks TASK-2700..2709, test TEST-0900
- [STORY-0901] Cold-object tiering / offload with read-through — tasks TASK-2710..2719, test TEST-0901
- [STORY-0902] Replication status, reconciliation & admin UI — tasks TASK-2720..2729, test TEST-0902

## Dependencies

- Blocks: —
- Blocked by: leans on the object write path (`domain/objects`), the background
  tick (`common/background`), and the existing backup/restore machinery.

## References

- `libs/nestjs/src/lib/domain/objects/object.service.ts`, `storage/blob-store.ts`,
  `common/background/`, `admin/backup/` (existing snapshot/restore).
- The AWS S3 SDK is already a proven client shape (see the README S3-SDK section).
