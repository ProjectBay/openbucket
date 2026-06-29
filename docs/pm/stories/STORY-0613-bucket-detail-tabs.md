---
id: STORY-0613
title: Bucket-detail tabbed page (versioning, encryption, tagging, lifecycle, CORS, policy)
epic: EPIC-07
status: done
size: L
risk: medium
---

## User story
As an operator, I want to open a bucket and manage its configuration from tabs — Objects, Properties, Versioning, Encryption, Tags, Lifecycle, CORS, Policy — so every bucket-level S3 feature has a clear home.

## Description
`bucket-detail.component.ts` is a "Coming soon" stub and is bypassed (the bucket list links straight to `…/browse`). Build the tabbed detail page on the new admin endpoints (STORY-0612), giving each config feature a place; deep-link tabs via `?tab=`.

## Acceptance criteria
- [ ] `bucket-detail.component.ts` uses `HlmTabs` (honoring `AppearanceStore.tabsVariant`): Objects (hosts/links the browser), Properties, Versioning, Encryption, Tags, Lifecycle, CORS, Policy.
- [ ] Versioning toggle (`hlm-switch`) + encryption default toggle + object-lock status badge read/write via the admin endpoints; Tags is a key/value editor; Lifecycle a rule-list editor; CORS/Policy a validated editor (JSON `hlm-textarea` acceptable in v1).
- [ ] The bucket list links to `/buckets/:name` (detail) instead of `…/browse`; the Objects tab deep-links to the browser; `?tab=` is deep-linkable; `PageHeaderService.setHasTabs(true)`.
- [ ] All saves toast; unconfigured features show an `hlm-empty` state; mutations confirm where destructive.

## Tasks
- [TASK-1867] Build `bucket-detail.component.ts` shell with `HlmTabs` + `?tab=` deep-link + `setHasTabs`.
- [TASK-1868] Properties/Versioning/Encryption panels (switches/badges) wired to admin endpoints (STORY-0612).
- [TASK-1869] Tags key/value editor (bucket tagging endpoints).
- [TASK-1870] Lifecycle rule-list editor.
- [TASK-1871] CORS + Policy editors (validated textarea/form).
- [TASK-1872] Re-link bucket-list name → `/buckets/:name`; bucket-list status badges; i18n keys.

## Test plan
- [TEST-0613] E2E/manual: each tab loads + persists config via the admin API; deep-link `?tab=`; empty states for unconfigured features; toasts on save; bucket list reflects status badges.

## Dependencies
- Blocks: _none_
- Blocked by: [STORY-0602], [STORY-0612]

## References
- UX review 2026-06-22 (power-user D; IA D/F3/F4).
- `apps/openbucket-frontend/src/app/buckets/{bucket-detail,bucket-list}.component.ts`, `app.routes.ts`, `libs/ui/spartan/{tabs,switch,badge,textarea,empty}`, `libs/api-client` (new endpoints).
