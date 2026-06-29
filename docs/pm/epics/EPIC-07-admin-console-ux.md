---
id: EPIC-07
title: Admin console — UX excellence & full S3 feature coverage
status: backlog
whitepaper_section: "§5.1–§5.15 (extends beyond the white paper)"
owner_area: frontend
---

## Objective

Turn the OpenBucket admin SPA from a working proof-of-concept into a
best-in-class storage console (Linear / Stripe / Cloudflare R2 polish) by
**fully exploiting the stack already in the repo** — spartan-ng, the 12-theme +
dark-mode appearance engine, ngrx/signals, ngx-translate, and the OpenAPI
client — and by exposing the large set of S3 capabilities the backend already
implements but the admin API/UI do not surface. The guiding constraint is "most
perfectly use the setup we already have": no new frameworks; replace hand-rolled
markup with the installed component library; light up infrastructure that exists
but is unreachable; and fill the placeholder screens.

Derived from a five-lens UX/UI review (design-system, interaction & async
states, information architecture, accessibility, and power-user/feature
coverage) of the live code on 2026-06-22.

## Scope

- In scope:
  - Adopt spartan-ng across the feature screens (tables, buttons, dialogs,
    badges, empty/skeleton states) — retire raw `<table>`/`<button>`/hand-rolled
    modals in buckets, objects, keys, auth.
  - Light up built-but-unreachable infrastructure: the 12-theme/dark/shell/locale
    appearance engine (Settings screen), the ⌘K `command` palette, sonner toasts.
  - Real domain navigation + IA: sidebar that maps to Buckets/Keys/Settings, a
    dashboard, a tabbed bucket-detail page, deep-linkable object browser, real
    breadcrumbs, a 404; delete the dead `shared/layout/*` shell.
  - Fill placeholder screens: keys management, bucket detail, settings,
    change-password, force-rotate, the shared confirm/secret dialogs.
  - Power-user workflows: object multi-select + bulk delete, pagination/page-size,
    prefix search, row action menus, copy-to-clipboard, upload overhaul.
  - Thin admin REST endpoints over existing domain services to expose the S3
    config surface (versioning, tagging, encryption, lifecycle, CORS, bulk
    delete, object versions/retention, presigned URLs) + regenerate the client.
  - Accessibility to WCAG 2.2 AA (focus management via spartan dialogs,
    keyboard-operable rows, live regions, named controls, contrast across all 12
    themes, reduced-motion) and re-enabling the downgraded angular-eslint a11y
    rules.
  - i18n: move hardcoded feature-screen strings into en/de translation files.
- Out of scope:
  - New S3 protocol features or domain logic — this epic only *exposes* what the
    S3 layer (EPIC-02/03) already implements.
  - Multi-tenant / per-application sub-keys (single-tenant remains, per §1).
  - A visual redesign of the spartan-ng primitives themselves (use them as-is).

## Success criteria

- Zero hand-rolled `<table>`/modal/`<button>` markup on buckets/objects/keys/auth;
  every interactive surface uses a spartan-ng component.
- A Settings → Appearance screen lets an admin switch any of the 12 color
  themes, light/dark, shell variant, and locale (no localStorage editing).
- Every mutation (create/delete/upload/copy/config change) shows a sonner toast;
  every destructive action routes through one confirm dialog; no list ever shows
  a bare "Loading…"/blank — skeletons + `empty` states throughout.
- The object browser supports multi-select + bulk delete, page-size + prefix
  search + counts, per-row actions, and a deep-linkable `?prefix=` URL.
- Keys, bucket-detail (with versioning/encryption/tagging/lifecycle/CORS), and
  the dashboard are functional (no "Coming soon" placeholders remain).
- `nx lint openbucket-frontend` passes with the angular-eslint a11y rules set
  back to `error`; the console is fully keyboard-operable and announces async
  status to screen readers; WCAG 2.2 AA contrast holds across all 12 themes.
- The committed `@openbucket/api-client` covers the new admin endpoints and is
  byte-equal to a fresh regeneration (STORY-0500 gate stays green).

## Stories

- [STORY-0600] Shared UX kit: toasts, confirm dialog, copy-button, live-region announcer
- [STORY-0601] App-shell cleanup, brand component & page-header unification
- [STORY-0602] Domain navigation, routing, breadcrumbs & 404 page
- [STORY-0603] Buckets list on spartan-ng (create dialog, delete-confirm, badges, states)
- [STORY-0604] Object browser rebuild: spartan table, multi-select, bulk delete, row actions
- [STORY-0605] Object listing UX: pagination, page-size, prefix search, counts, deep-link
- [STORY-0606] Upload UX overhaul: progress, drag affordance, cancel/retry, summary
- [STORY-0607] Appearance & Settings screen (themes/dark/shell/locale) + change-password
- [STORY-0608] Auth & login polish on the design system (login, force-rotate)
- [STORY-0609] Dashboard / home overview
- [STORY-0610] ⌘K command palette & keyboard shortcuts
- [STORY-0611] Access-keys management screen
- [STORY-0612] Admin REST endpoints for the S3 config surface + client regeneration
- [STORY-0613] Bucket-detail tabbed page (versioning, encryption, tagging, lifecycle, CORS, policy)
- [STORY-0614] Object versions, tagging & retention UI
- [STORY-0615] Presigned share links
- [STORY-0616] Accessibility & inclusive-design hardening (WCAG 2.2 AA)
- [STORY-0617] i18n completeness for feature screens

## Dependencies

- Blocks: _none_
- Blocked by: [EPIC-05] (admin API + SPA), [EPIC-06] (OpenAPI client pipeline).
  STORY-0612 (new admin endpoints) gates the feature-UI stories 0604/0613/0614/0615.

## References

- Five-lens UX/UI review of the live SPA (2026-06-22): design-system,
  interaction & async-state, information-architecture, accessibility, and
  power-user/feature-coverage agents.
- `docs/WHITEPAPER.md` §5.1–§5.15 (admin frontend & auth) — this epic extends it.
- Code: `apps/openbucket-frontend/src/app/**`, `libs/ui/spartan/**`,
  `libs/api-client/**`, `apps/openbucket-backend/src/admin/**`,
  `apps/openbucket-backend/src/domain/**` (S3 config services already implemented).

## Note on decomposition

Stories are authored at `backlog`. Per `conventions/workflow.md`, each Story's
individual Task and Test-Plan files are created when the Story is refined to
`ready`; until then the Task breakdown lives inline in each Story file and the
Test Plan is described inline under "Test plan". Reserved ID ranges (see
`conventions/ids.md`): Stories STORY-0600..0699, Tasks TASK-1800..2099, Tests
TEST-0600..0699.
