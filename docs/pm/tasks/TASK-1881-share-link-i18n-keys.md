---
id: TASK-1881
title: i18n keys for the share-link UI
story: STORY-0615
status: done
type: implementation
size: XS
---

## Description
Add translation keys for every user-facing string in the share-link UI (menu label, expiry option labels, success toast with expiry, and the error toasts from TASK-1880) to `en.translations.ts` and `de.translations.ts`.

## Files to create / modify
- `apps/openbucket-frontend/src/app/i18n/en.translations.ts` — modify (add a `share` / `objects.share` key group)
- `apps/openbucket-frontend/src/app/i18n/de.translations.ts` — modify (mirror the keys)
- `apps/openbucket-frontend/src/app/objects/share-link.component.ts` — modify (replace literals with the `| translate` pipe)

## Implementation notes
- Add a nested group under the existing default-export object, e.g. `objects: { share: { menuLabel, expiry1h, expiry24h, expiry7d, copied, expiresIn, errorExpiryTooLong, errorNotFound, errorGeneric } }`. Keep `en` and `de` key paths identical.
- Components use `TranslateModule` + the `| translate` pipe, matching the shell headers' pattern (e.g. `page-header.component.ts`). For the success toast naming the expiry, use a parameterized translation (`translate.instant('objects.share.expiresIn', { time })`) so the duration interpolates in both languages.
- No hardcoded English literals in the share-link template/handlers — enforced by STORY-0617.

## Acceptance criteria
- [ ] `nx build openbucket-frontend` and `nx lint openbucket-frontend` pass.
- [ ] Every share-link string resolves through a translation key; `de` shows German when the locale is switched.
- [ ] `en.translations.ts` and `de.translations.ts` have identical key paths for the new `share` group.

## Test obligations
- Unit: covered by [TEST-0615] (keys resolve; no literals).
- E2E: covered by [TEST-0615] (manual: switch to `de`).
- Conformance: N/A.

## Dependencies
- Blocked by: [TASK-1878], [TASK-1879], [TASK-1880]

## References
- UX review 2026-06-22 (power-user G; cross-cutting i18n note).
- `apps/openbucket-frontend/src/app/i18n/{en,de}.translations.ts`, `apps/openbucket-frontend/src/app/layout/shell/components/page-header.component.ts` (translate-pipe pattern).
- Related: [STORY-0617] (i18n completeness convention).
