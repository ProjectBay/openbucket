---
id: STORY-0617
title: i18n completeness for feature screens
epic: EPIC-07
status: done
size: S
risk: low
---

## User story
As a non-English admin, I want the whole console translated, so the feature screens aren't a mix of translated chrome and hardcoded English.

## Description
ngx-translate is wired with en/de, but only the sidebar/shell uses translation keys — every feature screen (buckets/objects/keys/auth/settings) hardcodes English strings, and `en.translations.ts` carries stale keys for pages that don't exist. As EPIC-07 screens are (re)built they add new strings; this story ensures they go through i18n and prunes dead keys.

## Acceptance criteria
- [ ] All user-facing strings in the (re)built feature screens use translation keys; no hardcoded English literals in templates.
- [ ] `i18n/en.translations.ts` + `de.translations.ts` cover every key; stale/unused keys pruned.
- [ ] A lint/check (or doc convention) flags new hardcoded strings.

## Tasks
- [TASK-1889] Extract hardcoded strings from buckets/objects/keys/auth/settings into `i18n/en.translations.ts`; add `TranslateModule` where missing.
- [TASK-1890] Provide German translations in `de.translations.ts`; prune stale keys.
- [TASK-1891] Audit toast/confirm/empty-state/upload-summary strings (from STORY-0600 consumers) for keys.
- [TASK-1892] Document the "no hardcoded UI strings" convention; optional lint rule.

## Test plan
- [TEST-0617] Manual: switch locale to de and walk the core screens — all strings translate; grep shows no hardcoded literals in feature templates.

## Dependencies
- Blocks: _none_
- Blocked by: [STORY-0603], [STORY-0604], [STORY-0607], [STORY-0611] (the screens that introduce strings)

## References
- UX review 2026-06-22 (cross-cutting i18n notes from interaction + IA + power-user lenses).
- `apps/openbucket-frontend/src/app/i18n/{en,de}.translations.ts`, all feature components.
