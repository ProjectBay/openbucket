---
id: TASK-3334
title: Build the signals-based audit-log viewer UI
story: STORY-1103
status: backlog
type: implementation
size: M
---

## Description
Add the `/audit` console page: a signals-based store over the generated `AuditAdminService`, a standalone Angular component with a filter bar (event dropdown, actor/bucket inputs, from/to datetimes) and a cursor "Load more" pager, plus the route, sidebar entry, and i18n strings. Mirrors the keys feature (`keys.signal-store.ts` + `keys-list.component.ts`) and reuses the shared `ob-list-state` / relative-time / sort-header primitives.

## Files to create / modify
- `apps/openbucket-frontend/src/app/audit/audit.signal-store.ts` — new (`AuditSignalStore`)
- `apps/openbucket-frontend/src/app/audit/audit-log.component.ts` — new (`AuditLogComponent`, `ob-audit-log`)
- `apps/openbucket-frontend/src/app/app.routes.ts` — modify (lazy `audit` child route under the shell)
- the sidebar nav config under `apps/openbucket-frontend/src/app/layout/` — modify (add an "Audit log" item, e.g. under an Admin group with a lucide icon)
- `apps/openbucket-frontend/src/app/i18n/` locale JSON (e.g. `en.json`) — modify (add the `audit.*` keys)

## Implementation notes
- `AuditSignalStore` (`@Injectable({ providedIn: 'root' })`, mirror `keys.signal-store.ts`), holding `signal`s and exposing `.asReadonly()`:
  ```ts
  private readonly _items = signal<AuditEvent[]>([]);
  private readonly _loading = signal(false);
  private readonly _error = signal<string | null>(null);
  private readonly _nextCursor = signal<string | null>(null);
  readonly filters = signal<{ event?: string; subject?: string; bucket?: string; from?: string; to?: string }>({});
  readonly hasMore = computed(() => this._nextCursor() !== null);

  async refresh(): Promise<void>;   // reset cursor, call listAuditEvents(...filters, limit=50), replace items
  async loadMore(): Promise<void>;  // call with cursor=_nextCursor(), append items
  async loadCatalog(): Promise<void>; // getAuditCatalog() → event dropdown options
  ```
  Wrap calls in `firstValueFrom(this.api.listAuditEvents(...))` exactly like `KeysSignalStore.refresh`. On error set `_error` and surface via `notify.error`.
- `AuditLogComponent` (standalone, `ChangeDetectionStrategy.OnPush`), reusing imports seen in `keys-list.component.ts`: `HlmTableImports`, `HlmBadge` (color the event name), `HlmButton`, `TranslateModule`, `ListStateComponent`, `RelativeTimePipe`, `CopyButtonComponent` (for `requestId`). Filter controls use `HlmSelect` (event, populated from the catalogue — same component the backup-restore/settings pages use) + `hlmInput` text fields (actor, bucket) + two native `<input type="datetime-local">` for from/to (no new datepicker dep). A "Filter" button (or debounced change) calls `store.refresh()`.
  - Columns: **Time** (`ts | relativeTime`, title=absolute), **Event** (`hlm-badge`), **Actor** (`subject`, or "—"), **Target** (`bucket` / `objectKey` or `keyId`), **IP**, **Request** (`requestId` + `ob-copy-button`).
  - Below the table, a "Load more" `hlmBtn` shown when `store.hasMore()`, calling `store.loadMore()`.
  - Set the page header via `PageHeaderService.setPageHeader('audit.title', 'audit.subtitle')` in the constructor (as `keys-list.component.ts` does); no action button.
  - Empty/error/loading are delegated to `ob-list-state` (`emptyTitle="audit.empty"`, `[skeletonCount]="6"`).
- Route (mirror the `keys` entry in `app.routes.ts`, inside the shell children behind `[authGuard, mustNotRotateGuard]`, lazy-loaded):
  ```ts
  { path: 'audit', data: { breadcrumb: 'sidebar.admin.audit' },
    loadComponent: () => import('./audit/audit-log.component').then((m) => m.AuditLogComponent) },
  ```
- Sidebar: add an item pointing at `/audit` in the existing nav config (same place the keys/backup-restore items live) with a lucide icon (e.g. `lucideScrollText`), and add the matching `sidebar.admin.audit` + `audit.*` i18n keys to every locale file already present under `i18n/` (keep locales in sync).
- Edge cases: keep filter state in the store so re-entering the route preserves it or resets deliberately; disable "Load more" while `loading()`; a filter change resets the cursor (never appends across different filters). All list/head data already flows through the mount-prefix-aware API providers (`shared/api/api-client.providers.ts`) — no base-URL handling needed here.
- Security: page sits behind the SPA `authGuard`; it only reads admin-authenticated endpoints. `detail` is rendered as read-only text — do not `innerHTML` it (avoid XSS from stored values); render via interpolation/`json` pipe.

## Acceptance criteria
- [ ] `/audit` renders a table of recent events, newest-first, behind the auth guard.
- [ ] The event dropdown is populated from `getAuditCatalog`; setting any filter and applying re-queries the backend and updates the list.
- [ ] "Load more" appends the next page and hides when `nextCursor` is null.
- [ ] A sidebar entry navigates to `/audit`; the breadcrumb/title strings resolve in all shipped locales.
- [ ] `nx lint openbucket-frontend` and `nx build openbucket-frontend` pass.

## Test obligations
- Unit: covered by [TEST-1103] (store: refresh/loadMore/cursor, component render)
- E2E: covered by [TEST-1103] (navigate `/audit`, filter, paginate)
- Conformance: N/A

## Dependencies
- Blocked by: [TASK-3333]
</content>
