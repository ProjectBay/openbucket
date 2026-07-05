---
id: EPIC-13
title: Adoption & observability
status: backlog
whitepaper_section: "future — post-1.0 feature (extends §4, §5)"
owner_area: delivery
---

## Objective

The S3 surface, security, durability, multi-tenancy, and console are built — the
gate on real-world use is now **how easily a team can adopt OpenBucket and trust it
in production**. This Epic delivers the two jobs that matter at this stage:
**adoption** (meet developers where they already are — a drop-in Multer storage
engine + NestJS sugar + a CLI) and **operational trust** (Prometheus `/metrics` +
OpenTelemetry, scheduled backups with retention, and a background integrity
scrubber that detects and repairs on-disk bit-rot). None of these add S3 surface;
they turn a capable store into one an SRE will deploy and a developer will pick.

## Scope

- In scope:
  - **Multer storage engine + NestJS upload adapter** — `openBucketStorage(ob, …)`
    so any existing `multer` / `FileInterceptor` app writes to OpenBucket in one
    line, plus a NestJS param decorator returning `{ key, url }`. [STORY-1200]
  - **`openbucket` CLI** — bucket/key/backup/replication admin ops over the admin
    API without curl. [STORY-1201]
  - **Prometheus `/metrics` + OpenTelemetry** — export the request/usage metrics
    already collected in a scrape-able format, plus optional OTel spans. [STORY-1202]
  - **Scheduled backups + retention** — cron'd per-bucket / whole-instance
    snapshots, retention pruning, optional push to the replication target. [STORY-1203]
  - **Integrity scrubbing** — a background scrubber that re-hashes blobs against
    the stored `sha256`, flags corruption, and repairs from the replica when one is
    configured. [STORY-1204]
- Out of scope:
  - SSO/OIDC for the console (its own epic — larger auth surface).
  - Public share portal / one-time links, resumable (tus) uploads (a "sharing"
    epic).
  - The S3-gateway / remote-backing-store mode (a separate architectural epic).

## Success criteria

- An existing NestJS app swaps its multer storage to `openBucketStorage(ob, …)` and
  uploads land in OpenBucket unchanged — verified by a test app.
- `openbucket buckets ls` / `openbucket keys create --scope …` work against a
  running instance.
- `GET <mountPath>/metrics` returns Prometheus text with request rate, latency, and
  storage-usage gauges; scraping it into Grafana shows live data.
- A scheduled backup runs on its cadence, prunes past the retention window, and (if
  configured) lands a copy on the replication target.
- The scrubber detects a deliberately-corrupted blob, marks it, and — with a replica
  configured — restores the good copy; all without blocking request traffic.

## Stories

- [STORY-1200] Multer storage engine + NestJS upload adapter — tasks TASK-3600..3609, test TEST-1200
- [STORY-1201] `openbucket` CLI — tasks TASK-3610..3619, test TEST-1201
- [STORY-1202] Prometheus /metrics + OpenTelemetry — tasks TASK-3620..3629, test TEST-1202
- [STORY-1203] Scheduled backups & retention — tasks TASK-3630..3639, test TEST-1203
- [STORY-1204] Integrity scrubbing (bit-rot detection & repair) — tasks TASK-3640..3649, test TEST-1204

## Dependencies

- Blocks: —
- Blocked by: reuses `OpenBucketService` (STORY-0803 uploads), the metrics collected
  in EPIC-12, `admin/backup/` (EPIC-08), and the replication target (EPIC-10) for
  scrub-repair + backup push.

## References

- `libs/nestjs/src/lib/open-bucket.service.ts`, `open-bucket-upload.ts`,
  `common/metrics/`, `common/interceptors/request-metrics.interceptor.ts`,
  `admin/backup/backup.service.ts`, `storage/blob-store.ts` (stored sha256),
  `storage/replication/`.
