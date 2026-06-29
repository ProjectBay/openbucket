---
id: TASK-1887
title: Re-enable the downgraded angular-eslint a11y rules to error
story: STORY-0616
status: done
type: implementation
size: S
---

## Description
Promote the angular-eslint template a11y rules back to `error` in the frontend ESLint config and fix any residual violations the rest of STORY-0616 (and the rebuilt screens) did not already cover, so `nx lint openbucket-frontend` enforces accessibility going forward.

## Files to create / modify
- `apps/openbucket-frontend/eslint.config.mjs` — modify (set the a11y rules to `error`)
- Any feature template still tripping a rule — modify (fix the residual violation)

## Implementation notes
- The frontend config (`apps/openbucket-frontend/eslint.config.mjs`) currently extends `nx.configs['flat/angular-template']` and then, in the `files: ['**/*.html']` block, downgrades only `'@angular-eslint/template/elements-content': 'warn'`. The a11y rules ship via the angular-template preset; this task pins the story's named rules to `error`:
  - `@angular-eslint/template/click-events-have-key-events`
  - `@angular-eslint/template/interactive-supports-focus`
  - `@angular-eslint/template/label-has-associated-control`
  - `@angular-eslint/template/elements-content`
  - `@angular-eslint/template/valid-aria`
- Set them all to `'error'` in the `files: ['**/*.html']` block (replacing the lone `elements-content: 'warn'`). The block's comment explains why it is `*.html`-only (the `@angular-eslint/template` plugin is registered for templates, not `.ts`); keep that scoping.
- The pre-existing `click-events-have-key-events` failure (the host-`(click)` `<tr>` in `object-row.component.ts`) is removed by STORY-0604 (TASK-1820 makes rows keyboard-operable); icon-only-name failures are removed by TASK-1883/1802; empty-element/`valid-aria` by TASK-1886. This task is the flip + a sweep for anything left.
- Run `nx lint openbucket-frontend` and fix each remaining violation in place (do not re-downgrade a rule to make it pass).

## Acceptance criteria
- [ ] `apps/openbucket-frontend/eslint.config.mjs` sets `click-events-have-key-events`, `interactive-supports-focus`, `label-has-associated-control`, `elements-content`, and `valid-aria` to `error`.
- [ ] `nx lint openbucket-frontend` passes with those rules at `error` (zero violations).
- [ ] No a11y rule was left at `warn`/`off` to make the run green.

## Test obligations
- Unit: N/A.
- E2E: covered by [TEST-0616] (lint gate is the automated anchor).
- Conformance: N/A.

## Dependencies
- Blocked by: [TASK-1882], [TASK-1883], [TASK-1886], [STORY-0603], [STORY-0604]

## References
- UX review 2026-06-22 (a11y A11Y-3/4/5; F1–F12 — a11y rules downgraded to `warn`).
- `apps/openbucket-frontend/eslint.config.mjs` (the `files: ['**/*.html']` block currently sets only `elements-content: 'warn'`); angular-eslint template rules.
