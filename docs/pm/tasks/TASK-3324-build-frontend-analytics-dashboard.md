---
id: TASK-3324
title: Build the frontend analytics signal store and dashboard charts
story: STORY-1102
status: backlog
type: implementation
size: M
---

## Description

Extend the home dashboard with usage charts driven by the new endpoints: a
storage-over-time area chart, a per-bucket size bar breakdown, and a
request/error mini-chart, plus a live request-rate stat card. Follow the
existing signals patterns — a root signal store like `BucketsSignalStore`,
`StatCardComponent` for KPIs, `ByteSizePipe` for sizes — and render charts as
hand-rolled inline SVG components (no new chart dependency).

## Files to create / modify

- `apps/openbucket-frontend/src/app/home/analytics.signal-store.ts` — new
- `apps/openbucket-frontend/src/app/shared/ui/area-chart.component.ts` — new
- `apps/openbucket-frontend/src/app/shared/ui/bar-chart.component.ts` — new
- `apps/openbucket-frontend/src/app/home/home.component.ts` — modify (add the
  charts below the existing stat-card grid + a request-rate stat card)
- `apps/openbucket-frontend/src/app/i18n/en.translations.ts` — modify (add
  `dashboard.*` analytics keys)
- `apps/openbucket-frontend/src/app/i18n/de.translations.ts` — modify (mirror keys)

## Implementation notes

- **Signal store** — copy `buckets.signal-store.ts` verbatim in style
  (`@Injectable({ providedIn: 'root' })`, private writable signals + readonly
  views, `firstValueFrom` over the generated `AnalyticsService`). Hold
  `storage`, `breakdown`, `requests`, `loading`, `error` signals and a
  `range = signal<'24h'|'7d'|'30d'>('7d')`; `refresh()` fans out the three calls
  in parallel (`Promise.all`) and sets the signals. Expose a `computed()`
  `storageDelta` (last vs first point) for a trend label on the stat card.
- **Bounded polling** — the dashboard must not hammer the `default` throttler
  (100/min). Refresh on `ngOnInit` and, optionally, on a `setInterval` >= 30 s
  cleared in `ngOnDestroy` (or a `toSignal(interval(30_000))`), well under the
  limit. Pause when the tab is hidden (`document.visibilityState`) to avoid
  background polling.
- **Charts** — two small standalone `ChangeDetectionStrategy.OnPush` components
  taking `input()` signals and emitting an `<svg viewBox>` scaled with a linear
  map (no d3/echarts). `ob-area-chart` plots `{ t, value }[]` as a filled path +
  baseline; `ob-bar-chart` plots `{ label, value }[]` horizontal bars with the
  value formatted by `ByteSizePipe`. Use `currentColor` / Tailwind theme tokens
  (`text-primary`, `fill-muted`) so they match `StatCardComponent` and work in
  light/dark. Add `role="img"` + an `aria-label` summarizing the series
  (accessibility parity with the rest of `shared/ui`). Keep a small fixed height
  (e.g. `h-40`) and `width=100%` so the page never scrolls horizontally.
- **Home wiring** — inject `AnalyticsSignalStore` alongside the existing
  `BucketsSignalStore`. Keep the current three stat-cards; add a fourth
  `ob-stat-card` for live request rate (`value` = `req/min`, icon
  `lucideActivity`) and, below the recent-buckets/quick-actions grid, an
  analytics section: storage area chart (title `dashboard.storageOverTime`),
  bucket bar breakdown (`dashboard.bucketBreakdown`), and the request/error
  mini-chart (`dashboard.requestRates`), each in an `hlmCard` matching the
  existing layout. Reuse the loading skeletons via the stat-card `loading` input
  and an empty state when `store.storage().length === 0`.
- **Client regeneration** — `AnalyticsService` and its models come from
  regenerating `@openbucket/api-client` after [TASK-3323] lands
  (`nx run api-client:generate`); import the generated `StorageSeriesDto` etc.
  rather than hand-writing shapes.
- **Edge cases** — fresh instance / no samples → empty-state card, no chart
  errors (guard against empty arrays: render a "collecting data…" hint). A
  bucket with 0 size is a 0-height bar, not omitted. Sizes are `sizeBytes`
  numbers → `ByteSizePipe`; timestamps are ISO strings → `RelativeTimePipe` for
  axis labels.
- **Security** — read-only, same admin session/cookie as the rest of the SPA; no
  new token handling. Charts render server-computed aggregates only (no raw
  object keys), so nothing sensitive is added to the DOM.

## Acceptance criteria

- [ ] The home page shows a storage-over-time area chart, a per-bucket bar
      breakdown, and a request/error chart, all populated from the analytics
      endpoints.
- [ ] Sizes render via `ByteSizePipe`; a fourth stat-card shows a live request
      rate; totals in the breakdown match the storage series' latest point.
- [ ] With no samples the section shows an empty/"collecting" state and does not
      error.
- [ ] `nx build openbucket-frontend` and `nx lint openbucket-frontend` pass; the
      api-client `git diff --exit-code` gate is satisfied (regenerated + committed).
- [ ] Polling interval is >= 30 s and cleared on destroy (no leaked interval).

## Test obligations

- Unit: covered by [TEST-1102] (case 10 — signal store maps responses; chart
  scaling helper).
- E2E: covered by [TEST-1102] (case 11 — dashboard renders charts against a
  seeded backend).
- Conformance: N/A.

## Dependencies

- Blocked by: [TASK-3323].

## References

- `apps/openbucket-frontend/src/app/buckets/buckets.signal-store.ts`
  (signal-store pattern), `home/home.component.ts` (stat-card grid to extend)
- `apps/openbucket-frontend/src/app/shared/ui/stat-card.component.ts`,
  `byte-size.pipe.ts`, `relative-time.pipe.ts`
- `apps/openbucket-frontend/src/app/i18n/en.translations.ts`,
  `de.translations.ts`
- `libs/api-client/project.json` (`AnalyticsService` regeneration)
