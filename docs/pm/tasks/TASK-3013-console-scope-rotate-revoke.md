---
id: TASK-3013
title: Build the console scope builder, rotate/revoke actions, and effective-permissions panel
story: STORY-1001
status: backlog
type: implementation
size: M
---

## Description
Extend the access-keys console (`apps/openbucket-frontend/src/app/keys/`) with a
scope builder on the create dialog, **Rotate** and **Revoke** actions in the row
menu, and an effective-permissions panel — all signals-based and `OnPush`,
matching the existing spartan-ng patterns. Rotate reuses the one-time secret
dialog. The panel renders the matrix from [TASK-3012].

## Files to create / modify
- `apps/openbucket-frontend/src/app/keys/key-create-dialog.component.ts` — modify. Add an optional scope section (buckets, prefix, actions) below the label field.
- `apps/openbucket-frontend/src/app/keys/keys.signal-store.ts` — modify. Add `rotate(id)`, `revoke(id)`, `effectivePermissions(id)`, `simulate(id, req)` over the regenerated `KeysAdminService`.
- `apps/openbucket-frontend/src/app/keys/keys-list.component.ts` — modify. Add **Rotate** / **Revoke** items to the row `hlm-dropdown-menu`; show a `scope`/scoped badge in the row; open the permissions panel.
- `apps/openbucket-frontend/src/app/keys/key-effective-permissions.component.ts` — new. A drawer/sheet that renders the allow/deny matrix + a one-line simulate input.
- `apps/openbucket-frontend/src/app/keys/key-secret-once-dialog.component.ts` — reuse (rotate emits a `CreatedKeyDto`-shaped payload → same one-time reveal).

## Implementation notes
- Follow the existing patterns exactly: standalone components, `ChangeDetectionStrategy.OnPush`, `signal`/`computed`/`inject`/`viewChild.required`, `HlmDialogImports`, `HlmButton`, `HlmInput`, `HlmSwitch`, `HlmDropdownMenuImports`, `notify` for toasts, `TranslateModule` keys under `keys.*`. Do not introduce a `Store`/NgRx — mirror `KeysSignalStore` (the store is `@Injectable({ providedIn: 'root' })` with private `signal`s exposed via `.asReadonly()`).
- Scope builder in `key-create-dialog.component.ts`: an optional block toggled by a switch ("Restrict this key to specific buckets"). When on, collect `buckets` (chip/list input), an optional `prefix`, and an `actions` multi-select from the closed enum in [TASK-3011]. Submit `store.create({ label, scope })`; when off, submit `{ label }` unchanged (root key). Keep the existing one-time-secret emit (`created` output → `KeySecretOnceDialogComponent.open`).
- Store methods (mirror `create`/`update`/`remove` at `keys.signal-store.ts:42-67`):
  - `rotate(id)` → `firstValueFrom(this.api.rotateKey(id))`; returns the `CreatedKeyDto`-shaped rotate response for the secret-once dialog; does not need to touch `_items` (secret is one-time, summary unchanged) but should refresh `lastUsedAt`/`disabled` if the response carries them.
  - `revoke(id)` → `firstValueFrom(this.api.revokeKey(id))`; update the item in `_items` to `disabled: true`.
  - `effectivePermissions(id)` → `firstValueFrom(this.api.getKeyEffectivePermissions(id))`.
  - `simulate(id, { action, resource })` → `firstValueFrom(this.api.simulateKeyAction(id, req))`.
- Row menu (`keys-list.component.ts` `#rowMenu`, currently only Delete at :167-178): add **Rotate** (opens a confirm, then on success opens `KeySecretOnceDialogComponent` with the new secret and `notify.success('Access key rotated')`), **Revoke** (confirm via `ConfirmDialogComponent`, destructive, then `store.revoke`, `notify.success('Access key revoked')`), and **Permissions** (opens `key-effective-permissions.component`). Keep **Delete** as the hard-remove. Distinguish Revoke (disable, reversible) from Delete (destroy) in copy.
- Show scope in the list: add a "Scope" column or a badge — a scoped key renders `hlmBadge variant="secondary"` "scoped" (root renders "root" as today, `keys-list.component.ts:129-135`). Guard against `scope` being `null`.
- `key-effective-permissions.component.ts`: input the key `id` + summary; on open call `store.effectivePermissions(id)`; render a `hlmTable` of `action | resource | decision` with a green/red badge per `decision`. Add a small "Simulate" row: `action` + `resource` inputs → `store.simulate` → show the decision. Loading/error via the shared `ob-list-state` pattern.
- After rotate/revoke, keep the SigV4 truth server-side ([TASK-3010] invalidates the cache) — the console just reflects state; do not attempt any client-side cache logic.
- i18n: add `keys.rotate`, `keys.revoke`, `keys.permissions`, `keys.scope`, `keys.scoped`, `keys.restrictScope`, matrix labels to the translation catalogue used by `TranslateModule`.

## Acceptance criteria
- [ ] `nx build openbucket-frontend` and `nx lint openbucket-frontend` pass with the new components.
- [ ] The create dialog can mint a scoped key; the created secret still shows exactly once via `KeySecretOnceDialogComponent`.
- [ ] The row menu exposes Rotate (→ one-time secret reveal), Revoke (→ key shows disabled), Permissions (→ matrix panel); Delete still hard-removes.
- [ ] The permissions panel renders the allow/deny matrix from `getKeyEffectivePermissions` and the simulate input returns a decision.
- [ ] All new components are `OnPush` + signals; no NgRx introduced.

## Test obligations
- Covered by [TEST-1001] (component/store specs for scope submit, rotate→secret-once, revoke→disabled, matrix render; the e2e scoped-key happy path).

## Dependencies
- Blocked by: [TASK-3014] (regenerated `KeysAdminService` with `rotateKey`/`revokeKey`/`getKeyEffectivePermissions`/`simulateKeyAction` + the `scope` DTO fields), [TASK-3011], [TASK-3012].
