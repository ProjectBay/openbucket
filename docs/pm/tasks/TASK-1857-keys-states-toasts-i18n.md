---
id: TASK-1857
title: Keys skeleton/empty states + toasts + keys i18n keys
story: STORY-0611
status: done
type: implementation
size: S
---

## Description
Add loading and empty states to the keys list (`HlmSkeleton` rows while loading, `hlm-empty` with a "Create access key" CTA when there are none), ensure every mutation fires a toast, and localize the keys screen's strings into the en/de dictionaries.

## Files to create / modify
- `apps/openbucket-frontend/src/app/keys/keys-list.component.ts` — modify (skeleton/empty branches + `translate`)
- `apps/openbucket-frontend/src/app/keys/key-create-dialog.component.ts` — modify (`translate` for labels)
- `apps/openbucket-frontend/src/app/keys/key-secret-once-dialog.component.ts` — modify (`translate` for labels/warning)
- `apps/openbucket-frontend/src/app/i18n/en.translations.ts` — modify (add `keys` namespace)
- `apps/openbucket-frontend/src/app/i18n/de.translations.ts` — modify (mirror keys, German values)

## Implementation notes
- Loading: while `store.loading()`, render `HlmSkeleton` placeholder rows (`@openbucket/spartan-ui/skeleton`, selector `[hlmSkeleton], hlm-skeleton`) matching the table's column layout so there is no layout shift.
- Empty: when `!store.loading() && store.count() === 0`, render `HlmEmptyImports` (`@openbucket/spartan-ui/empty`) with a title, description, and a "Create access key" `hlmBtn` CTA reusing the create flow (TASK-1855).
- Toasts: confirm create (TASK-1855), update/toggle and delete (TASK-1854) each fire `notify.success`/`notify.error` (`shared/ui/notify.ts`, STORY-0600). Add any missing toasts (e.g. relabel success/error).
- i18n: add a `keys` namespace to `i18n/{en,de}.translations.ts` (nested object, loaded via the `InMemoryTranslateLoader` in `app.config.ts`, consumed through the `@ngx-translate/core` `translate` pipe), e.g. `keys: { title, columns: { label, accessKeyId, role, lastUsed, status }, create: { cta, dialogTitle, label, submit }, secret: { title, warning, accessKeyId, secret, done }, empty: { title, description, cta }, toasts: { created, updated, deleted, error } }`. Replace hard-coded English in the three keys components with `translate` lookups; provide real German values.

## Acceptance criteria
- [ ] `nx build openbucket-frontend` and `nx lint openbucket-frontend` pass (Node 23).
- [ ] While loading, the keys list shows `HlmSkeleton` rows (no layout shift); with zero keys it shows an `hlm-empty` state with a "Create access key" CTA.
- [ ] Create / toggle / relabel / delete each fire a `notify` toast (success and error paths).
- [ ] `en.translations.ts` and `de.translations.ts` both carry a parallel `keys` namespace; the keys screen renders via the `translate` pipe and localizes to German.

## Test obligations
- Unit: N/A.
- E2E: covered by [TEST-0611] (skeleton/empty states; toasts on every mutation; locale spot check).
- Conformance: N/A.

## Dependencies
- Blocked by: [TASK-1854], [TASK-1855], [TASK-1856]

## References
- UX review 2026-06-22 (design — loading/empty states; interaction — feedback on every mutation; localization).
- `apps/openbucket-frontend/src/app/keys/{keys-list,key-create-dialog,key-secret-once-dialog}.component.ts`, `i18n/{en,de}.translations.ts`, `app.config.ts` (`InMemoryTranslateLoader`), `@ngx-translate/core` (`translate`), `libs/ui/spartan/{skeleton,empty,button}`, `shared/ui/notify.ts`.
- Interfaces consumed: `KeysSignalStore`, `notify`.
