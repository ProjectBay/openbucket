---
id: EPIC-12
title: Admin console v2
status: backlog
whitepaper_section: "future — post-1.0 feature (extends §5)"
owner_area: frontend
---

## Objective

Turn the admin console from "functional" into a tool people *enjoy* using daily.
The bucket/object browser, upload/download, and per-bucket config editors exist;
this Epic adds the day-to-day affordances that are conspicuously missing —
previewing objects without downloading, finding objects across buckets, seeing real
usage trends, and reading the audit trail the backend already emits (Pino audit
events) but nothing surfaces.

## Scope

- In scope:
  - **Object preview** — in-browser preview for images, PDFs, and text/code
    (with a size cap and safe rendering). [STORY-1100]
  - **Cross-bucket object search** — find objects by name/prefix/tag across buckets.
    [STORY-1101]
  - **Usage analytics dashboard** — storage-over-time, per-bucket size breakdown,
    object counts, and request/error rates. [STORY-1102]
  - **Audit-log viewer** — a filterable UI over the existing audit events
    (admin logins, bucket/object mutations, key changes). [STORY-1103]
- Out of scope:
  - Video/media playback beyond a basic thumbnail.
  - A full log-management/SIEM product — this surfaces OpenBucket's own audit stream.
  - Real-time streaming metrics (periodic refresh is enough for v1).

## Success criteria

- Clicking an image/PDF/text object opens an in-console preview without a full
  download, with a clear fallback + size guard for large/binary objects.
- A search returns matching objects across all buckets by name/prefix (and tag where
  indexed), with pagination.
- The dashboard shows storage growth over time and a per-bucket size breakdown that
  matches the real on-disk totals.
- The audit viewer lists recent security-relevant events with filters by
  actor/event/time, sourced from the existing audit stream.

## Stories

- [STORY-1100] Object preview (image / PDF / text) — tasks TASK-3300..3309, test TEST-1100
- [STORY-1101] Cross-bucket object search — tasks TASK-3310..3319, test TEST-1101
- [STORY-1102] Usage analytics dashboard — tasks TASK-3320..3329, test TEST-1102
- [STORY-1103] Audit-log viewer — tasks TASK-3330..3339, test TEST-1103

## Dependencies

- Blocks: —
- Blocked by: none functionally; the audit viewer consumes the existing
  `admin/audit` event stream (may need a query/store surface).

## References

- `apps/openbucket-frontend/src/app/` (objects browser, home dashboard,
  `shared/ui/stat-card`), `libs/api-client/`, `libs/nestjs/src/lib/admin/audit/`,
  `admin/objects/` (listing/head/metadata endpoints).
