---
id: TASK-1811
title: Make breadcrumbs show real bucket names and meaningful labels
story: STORY-0602
status: done
type: implementation
size: M
---

## Description
Fix the breadcrumb trail so it shows the actual bucket name and human labels instead of dropping dynamic `:name` segments. `BreadcrumbService` currently skips any segment whose path `includes(':')` — but the matched URL segment is already resolved, so the check is wrong; it should consume the real segment value (e.g. `my-bucket`) and a `data: { breadcrumb }` label where set. Result today: a deep bucket URL shows "Buckets › Browse" with the bucket name missing.

## Files to create / modify
- `apps/openbucket-frontend/src/app/layout/shell/services/breadcrumb.service.ts` — modify (fix dynamic-segment handling)
- `apps/openbucket-frontend/src/app/app.routes.ts` — modify (add `data: { breadcrumb }` on the static bucket routes)
- `apps/openbucket-frontend/src/app/buckets/breadcrumb.resolver.ts` — new (resolve the `:name` label) — optional if `data` alone suffices

## Implementation notes
- In `buildBreadcrumbs` the bug is in the `else if (!routeURL.includes(':'))` guard: `routeURL` is built from `snap.url.map((s) => s.path).join('/')`, which is the RESOLVED segment (`my-bucket`), never a literal `:name`. So the guard never trips for a param, yet the intent was to skip raw `:name`. Replace the logic so it: (1) uses `snap.data['breadcrumb']` when present (already supported), (2) otherwise, for a route segment that came from a parameter (detect via `snap.routeConfig?.path?.includes(':')` or `Object.keys(snap.params).length`), uses the resolved param value as the label (the bucket name) rather than dropping it, and (3) otherwise title-cases the static path via the existing `generateLabelFromPath`.
- Prefer route-driven labels for static segments: add `data: { breadcrumb: 'sidebar.storage.buckets' }` (an i18n key — the headers pipe crumbs through `| translate`) to the `buckets` route, and `data: { breadcrumb: 'breadcrumb.objects' }` (add this key in [TASK-1809]'s i18n files or here) to the `buckets/:name/browse` route. For `buckets/:name`, use the resolved param value (the bucket name) directly — a `breadcrumb.resolver.ts` returning `route.paramMap.get('name')` is the clean way; the service reads it from `snap.data['breadcrumb']` once resolved. `bucket-detail.component.ts` is still a placeholder, so the param value is the only available name source.
- Target trail for `/buckets/my-bucket/browse`: `Buckets › my-bucket › Objects` (matching the AC). Static labels are i18n keys, the bucket name is the raw param (not translated — wrap it so `translate` passes it through unchanged, e.g. crumbs already render `{{ crumb.label | translate }}` and missing keys fall through to the literal).
- Keep the `Breadcrumb` interface (`label`, `url`, `isLast`) and the `NavigationEnd` rebuild in the constructor unchanged; only the per-segment label logic changes.

## Acceptance criteria
- [ ] `nx build openbucket-frontend` and `nx lint openbucket-frontend` pass.
- [ ] Visiting `/buckets/my-bucket/browse` produces breadcrumbs `Buckets › my-bucket › Objects` (the bucket name is present, not dropped).
- [ ] Static segments use their `data: { breadcrumb }` label when set; no raw `:name` literal ever appears.

## Test obligations
- Unit: covered by [TEST-0602] (`buildBreadcrumbs` resolves param segments; if frontend jest is wired).
- E2E: covered by [TEST-0602] (deep bucket URL shows the bucket name).
- Conformance: N/A.

## Dependencies
- Blocked by: [TASK-1810]

## References
- UX review 2026-06-22 (IA lens F9 — breadcrumbs drop dynamic `:name`; auto-title-case raw segments).
- `apps/openbucket-frontend/src/app/layout/shell/services/breadcrumb.service.ts` (lines 46–67), `apps/openbucket-frontend/src/app/app.routes.ts` (bucket routes), `apps/openbucket-frontend/src/app/buckets/bucket-detail.component.ts` (placeholder — param is the name source).
