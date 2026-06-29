---
id: STORY-0609
title: Dashboard / home overview
epic: EPIC-07
status: done
size: M
risk: low
---

## User story
As an admin, I want a landing dashboard with totals, recent buckets, and quick actions, so I get an at-a-glance view and fast entry points instead of being dropped straight into a list.

## Description
`HomeComponent` is a "Replace this with real content" stub and isn't even routed (STORY-0602 adds the route). Build a real overview that reuses data the bucket store already has (`objectCount`, `sizeBytes`) and wires the header action button.

## Acceptance criteria
- [ ] `hlm-card` stat tiles: total buckets / total objects / total size (formatted via `ByteSizePipe`).
- [ ] A "Recent buckets" card list links into `/buckets/:name`; uses `RelativeTimePipe` + `hlm-separator`.
- [ ] A "Quick actions" card (Create bucket, Create access key) and a header-level "Create" action via `PageHeaderService.setActionButton`.
- [ ] OnPush + signals; empty state when there are no buckets yet.

## Tasks
- [TASK-1845] Build `home.component.ts` stat tiles from `BucketsSignalStore` aggregates.
- [TASK-1846] Recent-buckets card + links; quick-actions card.
- [TASK-1847] Wire `PageHeaderService.setActionButton` "Create".
- [TASK-1848] Empty state (`hlm-empty`) + dashboard i18n keys.

## Test plan
- [TEST-0609] Manual: totals match the bucket list; recent buckets link correctly; quick actions open the right dialogs; empty state shows on a fresh instance.

## Dependencies
- Blocks: _none_
- Blocked by: [STORY-0602], [STORY-0603]

## References
- UX review 2026-06-22 (IA B/F2).
- `apps/openbucket-frontend/src/app/home/home.component.ts`, `buckets/buckets.signal-store.ts`, `layout/shell/services/page-header.service.ts`, `shared/ui/{byte-size,relative-time}.pipe.ts`.
