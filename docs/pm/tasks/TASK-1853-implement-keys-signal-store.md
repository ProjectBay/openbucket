---
id: TASK-1853
title: Implement keys.signal-store.ts over KeysAdminService
story: STORY-0611
status: done
type: implementation
size: M
---

## Description
Replace the `keys.signal-store.ts` stub (`export {};`) with a real signal store that mirrors `BucketsSignalStore`: readonly `items`/`loading`/`error` signals plus `refresh`/`create`/`update`/`remove` mutations wired to the implemented `KeysAdminService`. Components read the readonly signals; mutations call the API and update state on success.

## Files to create / modify
- `apps/openbucket-frontend/src/app/keys/keys.signal-store.ts` — replace stub (new `KeysSignalStore`)

## Implementation notes
- Mirror `BucketsSignalStore` (`buckets/buckets.signal-store.ts`): `@Injectable({ providedIn: 'root' })`, private `_items = signal<KeySummaryDto[]>([])`, `_loading = signal(false)`, `_error = signal<string | null>(null)`, public `readonly items/loading/error` (`asReadonly()`), and `readonly count = computed(() => this._items().length)`.
- Inject `KeysAdminService` from `@openbucket/api-client`. Its method shapes:
  - `listKeys(): Observable<Array<KeySummaryDto>>` (note: returns the array directly, NOT wrapped in `{ keys }` like buckets).
  - `createKey(createKeyDto: CreateKeyDto): Observable<CreatedKeyDto>` (`CreateKeyDto { label }`; `CreatedKeyDto` includes the one-time `secretAccessKey`).
  - `updateKey(id: string, updateKeyDto: UpdateKeyDto): Observable<KeySummaryDto>` (`UpdateKeyDto { label?, disabled? }`).
  - `deleteKey(id: string): Observable<any>`.
- Methods (use `firstValueFrom` from rxjs, like the bucket store):
  - `async refresh(): Promise<void>` — set loading, `this._items.set(await firstValueFrom(this.api.listKeys()) ?? [])`, capture `(e as Error).message` into `_error`, clear loading in `finally`.
  - `async create(dto: CreateKeyDto): Promise<CreatedKeyDto>` — `const created = await firstValueFrom(this.api.createKey(dto))`; push its `KeySummaryDto`-shaped fields into `_items` (the list does not show the secret); return the full `CreatedKeyDto` so the caller can show the secret-once dialog.
  - `async update(id: string, dto: UpdateKeyDto): Promise<void>` — `const updated = await firstValueFrom(this.api.updateKey(id, dto))`; replace the matching item in `_items` by `id`.
  - `async remove(id: string): Promise<void>` — `await firstValueFrom(this.api.deleteKey(id)); this._items.update(arr => arr.filter(k => k.id !== id))`.
- `KeySummaryDto` fields: `{ id, accessKeyId, label, role, createdAt, lastUsedAt: string | null, disabled }` — use `id` (not `accessKeyId`) as the mutation key, matching the API path `/api/admin/keys/{id}`.

## Acceptance criteria
- [ ] `nx build openbucket-frontend` and `nx lint openbucket-frontend` pass (Node 23).
- [ ] `KeysSignalStore` exposes `items`/`loading`/`error`/`count` and `refresh`/`create`/`update`/`remove`, mirroring `BucketsSignalStore`'s read surface.
- [ ] `create` returns the full `CreatedKeyDto` (so the secret can be shown once) and inserts the new key into `items`; `update` replaces by `id`; `remove` filters by `id`.
- [ ] A frontend unit spec (if the jest harness is wired) verifies the store calls `KeysAdminService.list/create/update/delete` and updates `items` accordingly.

## Test obligations
- Unit: covered by [TEST-0611] (store calls the service + updates `items`).
- E2E: covered by [TEST-0611] (mutations reflected in the UI).
- Conformance: N/A.

## Dependencies
- Blocked by: [STORY-0600]

## References
- UX review 2026-06-22 (power-user C/F6 — keys UI is all placeholders despite a complete API).
- `apps/openbucket-frontend/src/app/keys/keys.signal-store.ts`, `buckets/buckets.signal-store.ts` (pattern), `libs/api-client/src/lib/api/keys-admin.service.ts` (`KeysAdminService.listKeys`/`createKey`/`updateKey`/`deleteKey`), models `KeySummaryDto`/`CreateKeyDto`/`CreatedKeyDto`/`UpdateKeyDto` (`@openbucket/api-client`).
- Interfaces produced: `KeysSignalStore` (consumed by TASK-1854/1855/1856/1857).
