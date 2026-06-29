---
id: TASK-1846
title: Add recent-buckets card (links + relative time) and quick-actions card
story: STORY-0609
status: done
type: implementation
size: M
---

## Description
Add two cards below the stat tiles on the dashboard: a "Recent buckets" card listing the most recently-created buckets with a `RelativeTimePipe` timestamp and a link into `/buckets/:name`, and a "Quick actions" card with shortcuts to create a bucket and create an access key. Rows are visually separated with `hlm-separator`.

## Files to create / modify
- `apps/openbucket-frontend/src/app/home/home.component.ts` — modify (add the two cards + a `recentBuckets` computed)

## Implementation notes
- Recent list: add `recentBuckets = computed(() => [...this.store.items()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 5))` over `BucketsSignalStore.items()` (`BucketSummaryDto.createdAt` is an ISO string). Render each as a `routerLink` to `['/buckets', bucket.name]` (import `RouterLink`); show `{{ bucket.createdAt | relativeTime }}` using `RelativeTimePipe` (`shared/ui/relative-time.pipe.ts`, pipe name `relativeTime`).
- Separators: import `HlmSeparator` from `@openbucket/spartan-ui/separator` (selector `[hlmSeparator], hlm-separator`) between rows.
- Cards: reuse `HlmCardImports` (`@openbucket/spartan-ui/card`) for both cards' chrome (header/title + content).
- Quick actions: two `hlmBtn` buttons (`@openbucket/spartan-ui/button`) — "Create bucket" and "Create access key". For now they navigate (`routerLink` to `/buckets` / `/keys`) or open the respective create dialogs once those exist (bucket create from STORY-0603, key create from STORY-0611). Keep them wired to the same callback used by the header "Create" action (TASK-1847) where it overlaps, so there is one create entry point.
- The deep-link route `/buckets/:name` is the breadcrumb-aware route established by STORY-0602; rely on it rather than inventing a new path.

## Acceptance criteria
- [ ] `nx build openbucket-frontend` and `nx lint openbucket-frontend` pass.
- [ ] A "Recent buckets" card lists up to 5 buckets, each linking to `/buckets/:name` and showing a `relativeTime` of `createdAt`, with `hlm-separator` between rows.
- [ ] A "Quick actions" card offers "Create bucket" and "Create access key" via `hlmBtn`.
- [ ] Clicking a recent bucket navigates to that bucket's detail route.

## Test obligations
- Unit: N/A.
- E2E: covered by [TEST-0609] (recent links resolve; quick actions open the right targets).
- Conformance: N/A.

## Dependencies
- Blocked by: [TASK-1845]

## References
- UX review 2026-06-22 (IA B/F2 — fast entry points on landing).
- `apps/openbucket-frontend/src/app/home/home.component.ts`, `buckets/buckets.signal-store.ts`, `libs/api-client` (`BucketSummaryDto.createdAt`/`.name`), `shared/ui/relative-time.pipe.ts` (`RelativeTimePipe`, `relativeTime`), `libs/ui/spartan/{card,separator,button}`.
- Interfaces consumed: `BucketsSignalStore`, `RelativeTimePipe`; bucket/key create dialogs (STORY-0603/0611).
