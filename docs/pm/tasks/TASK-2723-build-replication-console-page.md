---
id: TASK-2723
title: Build the Angular replication console page and signal store
story: STORY-0902
status: backlog
type: implementation
size: M
---

## Description

Add a `/replication` page to the admin SPA that shows replication health (lag,
pending/failed depth, last error) as stat cards, a per-bucket status table, and a
"Reconcile" action that starts a backfill job and polls it to completion. Mirrors
the `backup-restore` page: signals-based, lazy-loaded, spartan-ng UI, shared
confirm dialog + `notify` toasts, wired into routing and the sidebar with i18n.

## Files to create / modify

- `apps/openbucket-frontend/src/app/replication/replication.component.ts` — new
- `apps/openbucket-frontend/src/app/replication/replication.signal-store.ts` — new
- `apps/openbucket-frontend/src/app/app.routes.ts` — modify (add lazy `replication` route)
- `apps/openbucket-frontend/src/app/layout/sidebar/data/sidebar.data.ts` — modify (add nav item)
- `apps/openbucket-frontend/src/app/i18n/en.translations.ts` — modify (add `replication.*` keys)
- `apps/openbucket-frontend/src/app/i18n/de.translations.ts` — modify (add `replication.*` keys)

## Implementation notes

- **Signal store** (`@Injectable({ providedIn: 'root' })`), same shape as
  `BucketsSignalStore` — readonly signals + async mutations over the generated
  `ReplicationAdminService`:
  ```ts
  readonly status = signal<ReplicationStatusDto | null>(null);
  readonly loading = signal(false);
  readonly job = signal<ReconcileJobDto | null>(null);
  async refresh(): Promise<void>;                 // getReplicationStatus()
  async reconcile(bucket?: string): Promise<void>; // startReconcile() then poll
  ```
  Reconcile polling: after `startReconcile`, poll `getReconcileJob(jobId)` on an
  interval (e.g. 2s) until `state` is `completed`/`failed`; drive a `notify.promise`
  and refresh `status` at the end. Clear timers on destroy; guard against
  overlapping polls.
- **Component** (`standalone`, `ChangeDetectionStrategy.OnPush`): use
  `PageHeaderService.setPageHeader('replication.title', 'replication.subtitle')`
  in the constructor (as `BackupRestoreComponent` does). Layout:
  - Three `ob-stat-card`s: pending depth, lag (`oldestPendingAgeMs` via a
    relative/duration format), failed count (danger styling when > 0).
  - A per-bucket table using `ob-list-state` for loading/empty and the shared
    `ob-sort-header`s; format sizes/times with the existing `byte-size` /
    `relative-time` pipes.
  - "Reconcile all" + per-row "Reconcile bucket" buttons (`hlmBtn`), each guarded
    by `ob-confirm-dialog` (reconcile re-enqueues writes — confirm to avoid an
    accidental large remote push). While `job()?.state === 'running'`, disable the
    buttons and show progress (`missingRequeued` / scanned counts).
  - **Empty/disabled state:** when `status()?.enabled === false`, render a "replication
    not configured — set a target to enable" panel instead of zeroed cards, so an
    unconfigured instance never looks broken.
- **Routing:** add under the shell children in `app.routes.ts`:
  ```ts
  { path: 'replication', data: { breadcrumb: 'sidebar.admin.replication' },
    loadComponent: () => import('./replication/replication.component').then(m => m.ReplicationComponent) }
  ```
- **Sidebar:** add a `createSidebarConfig.item({ id: 'replication', title:
  'sidebar.admin.replication', icon: 'lucideRefreshCw', url: '/replication' })` near
  `backup-restore` (import the lucide icon via `provideIcons` where icons are
  registered).
- **i18n:** add a `replication` block and `sidebar.admin.replication` to BOTH
  `en` and `de` translation maps — the repo enforces "no hardcoded strings"
  (TASK-1892); every visible label is a translate key.
- No new HttpClient plumbing: call the generated `ReplicationAdminService` (from
  [TASK-2724]); auth cookie/JWT is attached by the existing `auth.interceptor.ts`.

## Acceptance criteria

- [ ] `nx build openbucket-frontend` compiles; `nx lint openbucket-frontend` is green (a11y rules at error).
- [ ] `/replication` renders stat cards + per-bucket table from `getReplicationStatus`, and shows the not-configured panel when `enabled` is false.
- [ ] Clicking Reconcile confirms, calls `startReconcile`, polls to `completed`, toasts, and refreshes status; buttons are disabled while a job runs.
- [ ] The sidebar shows a Replication entry that routes to `/replication`; all labels resolve through `en` and `de` translations (no literal strings).

## Test obligations

- Unit: covered by [TEST-0902] (signal-store refresh/reconcile-poll against a mocked `ReplicationAdminService`)
- E2E: N/A — SPA smoke covered by the store spec; no separate e2e harness for this page
- Conformance: N/A

## Dependencies

- Blocked by: [TASK-2724] (generated `ReplicationAdminService` + DTO models)

## References

- `apps/openbucket-frontend/src/app/backup-restore/backup-restore.component.ts` (page + confirm + notify + PageHeaderService)
- `apps/openbucket-frontend/src/app/buckets/buckets.signal-store.ts` (signal-store shape)
- `apps/openbucket-frontend/src/app/shared/ui/{stat-card,list-state,confirm-dialog,sort-header,notify}.*`, `relative-time.pipe.ts`, `byte-size.pipe.ts`
- `apps/openbucket-frontend/src/app/app.routes.ts`, `layout/sidebar/data/sidebar.data.ts`, `i18n/{en,de}.translations.ts`
</content>
