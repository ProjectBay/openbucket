---
id: TASK-3314
title: Build the cross-bucket search console page
story: STORY-1101
status: backlog
type: implementation
size: M
---

## Description

Add the `/search` console page: a signals-based standalone Angular component that
calls the generated `searchObjects` method, renders cross-bucket hits in a table
with mode/bucket/tag filters and keyset "next page" pagination, and links each
row to that object in the bucket browser. Register the route and a sidebar entry.

## Files to create / modify

- `apps/openbucket-frontend/src/app/objects/object-search.component.ts` — new
- `apps/openbucket-frontend/src/app/objects/object-search.component.spec.ts` — new
- `apps/openbucket-frontend/src/app/app.routes.ts` — modify (add `/search` under
  the authenticated shell)
- `apps/openbucket-frontend/src/app/layout/sidebar/data/sidebar.data.ts` — modify
  (add a `search` item, `icon: 'lucideSearch'`, `url: '/search'`)
- `apps/openbucket-frontend/src/app/i18n/**` (or the existing translation JSON) —
  modify (add `search.*` keys)

## Implementation notes

- Standalone, `ChangeDetectionStrategy.OnPush`, signals only — mirror
  `object-browser.component.ts` (which already imports `HlmTableImports`,
  `HlmInput`, `HlmButton`, `HlmSelectImports`, `ByteSizePipe`, `RelativeTimePipe`,
  `ob-list-state`, `notify`). Reuse `ObjectsAdminService` from
  `@openbucket/api-client` and `resolveMountPrefix` from `shared/api/mount-prefix`.
- State signals:

  ```ts
  readonly q = signal('');
  readonly mode = signal<'prefix' | 'contains'>('prefix');
  readonly bucket = signal<string | undefined>(undefined);
  readonly tagKey = signal(''); readonly tagValue = signal('');
  readonly results = signal<ObjectSearchHit[]>([]);
  readonly loading = signal(false); readonly error = signal<string | null>(null);
  private cursors: (string | undefined)[] = [undefined]; // page stack (keyset)
  readonly nextCursor = signal<string | undefined>(undefined);
  ```

- Debounce input (e.g. `toObservable(this.q).pipe(debounceTime(300),
  distinctUntilChanged())` with `takeUntilDestroyed`) before firing a search, so
  keystrokes don't hammer the endpoint (which is throttled at 100/min). Empty `q`
  clears results without a call.
- Fetch via `firstValueFrom(this.api.searchObjects(q, mode, bucket, tagKey,
  tagValue, cursor, limit))`; on success set `results` + `nextCursor`; on error set
  `error()` and `notify` a toast (same pattern as the browser). Client-side guard:
  disable submit for `contains` with `q.length < 2` (matches the server refinement)
  to avoid a predictable `400`.
- Pagination is keyset, not page-numbered: keep a stack of cursors so "Next" pushes
  `nextCursor` and "Prev" pops — do not attempt random page access (the API has no
  OFFSET). Use `HlmPaginationImports` for the controls but drive them off the stack.
- Render with `<ob-list-state [loading] [error] [empty]="results().length === 0"
  emptyTitle="search.empty" emptyHint="search.emptyHint">`. Each row shows bucket
  badge + key + size (`ByteSizePipe`) + modified (`RelativeTimePipe`). The key links
  to the browser: `routerLink=['/buckets', hit.bucket, 'browse']` with
  `queryParams` pointing at the object's prefix — encode the key once when building
  the link (raw keys come back from the API; the browser decodes once, matching the
  `decodeOnce`/`rawTail` contract server-side). Do not render key/tag values as raw
  HTML (Angular escapes by default — keep interpolation, no `[innerHTML]`).
- Route: add under the `''` shell children in `app.routes.ts`, guarded by the same
  `[authGuard, mustNotRotateGuard]` as siblings, lazy `loadComponent`, with
  `data: { breadcrumb: 'search.title' }`.

## Acceptance criteria

- [ ] Navigating to `/search`, typing a term, and choosing a mode lists matching
      objects across buckets with bucket + key + size + modified columns.
- [ ] Loading, error, and empty states render via `ob-list-state`; a failed request
      surfaces a toast, not a blank page.
- [ ] "Next"/"Prev" walk pages via the keyset cursor stack with no repeats; `contains`
      submit is disabled for `q.length < 2`.
- [ ] A result row links to that object in `/buckets/:bucket/browse` with the key
      correctly encoded once.
- [ ] The sidebar shows a "Search" entry that routes to `/search`.
- [ ] `nx test openbucket-frontend --testPathPattern=object-search.component.spec`
      and `nx build openbucket-frontend` pass; `nx lint openbucket-frontend` is clean.

## Test obligations

- Unit: covered by [TEST-1101] (case 10, component spec with a mocked service)
- E2E: covered by [TEST-1101] (case 5 exercises the same endpoint the page calls)
- Conformance: N/A

## Dependencies

- Blocked by: [TASK-3313]

## References

- `apps/openbucket-frontend/src/app/objects/object-browser.component.ts` (signals,
  spartan-ui imports, `firstValueFrom`, `notify`, `resolveMountPrefix`)
- `apps/openbucket-frontend/src/app/shared/ui/list-state.component.ts`
- `apps/openbucket-frontend/src/app/app.routes.ts`,
  `apps/openbucket-frontend/src/app/layout/sidebar/data/sidebar.data.ts`
- `@openbucket/api-client` (`ObjectsAdminService`, `ObjectSearchHit`)
