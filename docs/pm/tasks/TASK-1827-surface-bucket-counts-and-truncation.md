---
id: TASK-1827
title: Surface bucket objectCount/sizeBytes + truncation indicator in the header
story: STORY-0605
status: done
type: implementation
size: S
---

## Description
Show operators how big the bucket is and whether the current page is complete. Fetch the bucket's `BucketSummaryDto` once and render its `objectCount` and `sizeBytes` in the browser header, plus a "showing N (truncated)" indicator derived from the current listing response. The page count comes from the already-loaded `contents`/`commonPrefixes`; the truncation flag comes from `isTruncated`.

## Files to create / modify
- `apps/openbucket-frontend/src/app/objects/object-browser.component.ts` — modify (fetch summary; add header counts + truncation badge)

## Implementation notes
- Inject `BucketsAdminService` and call `getBucket(name)` → `Observable<BucketSummaryDto>` (`{ name, createdAt, versioning, objectLock, objectCount, sizeBytes }`, see `libs/api-client/src/lib/model/bucket-summary-dto.ts`). Store in a `readonly summary = signal<BucketSummaryDto | null>(null)` populated in `ngOnInit` after `bucket` is set.
- Render total objects as `summary()?.objectCount` and total size via the existing `ByteSizePipe` over `summary()?.sizeBytes`.
- Truncation: the listing response (`ListObjectsResponseDto`) carries `isTruncated` and `nextMarker`; `load()` already sets `nextMarker` from `res?.isTruncated ? res?.nextMarker : undefined`. Add a `readonly truncated = computed(() => !!this.nextMarker())` and show "showing {{ visibleObjects().length + visibleFolders().length }}{{ truncated() ? ' (truncated)' : '' }}".
- Use `HlmBadgeImports` from `@openbucket/spartan-ui/badge` for the truncation/count chips (the sidebar already imports `HlmBadgeImports`).

## Acceptance criteria
- [ ] `nx build openbucket-frontend` and `nx lint openbucket-frontend` pass (Node 23).
- [ ] The header shows the bucket's total `objectCount` and a human-readable `sizeBytes` (via `ByteSizePipe`).
- [ ] When the listing response `isTruncated` is true, a "(truncated)" indicator is shown; when the whole listing fits one page, it is not.

## Test obligations
- Unit: N/A.
- E2E: covered by [TEST-0605] (counts shown; truncated indicator on a large bucket).
- Conformance: N/A.

## Dependencies
- Blocked by: [STORY-0604]

## References
- UX review 2026-06-22 (IA C — no counts/size; F7 — truncation invisible).
- `apps/openbucket-frontend/src/app/objects/object-browser.component.ts`, `libs/api-client/src/lib/model/bucket-summary-dto.ts` (`objectCount`, `sizeBytes`), `libs/api-client/src/lib/model/list-objects-response-dto.ts` (`isTruncated`, `nextMarker`), `apps/openbucket-frontend/src/app/shared/ui/byte-size.pipe.ts`, `libs/ui/spartan/badge`.
