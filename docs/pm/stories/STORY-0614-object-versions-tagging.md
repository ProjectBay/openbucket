---
id: STORY-0614
title: Object versions, tagging & retention UI
epic: EPIC-07
status: done
size: M
risk: medium
---

## User story
As an operator, on a versioned bucket I want to see an object's versions and delete markers, download/restore/delete a specific version, and edit object tags and retention, so I can manage object history and compliance from the console.

## Description
`listObjectVersions`, object tagging, retention, and legal-hold all exist in the domain (exposed via STORY-0612). `ObjectMetaDto` already returns `tagging`/`userMetadata` but the UI never renders them. Add Versions and Tags sections to the object detail sheet (STORY-0604).

## Acceptance criteria
- [ ] The object detail `HlmSheet` gains a Versions tab listing versions + delete markers (id, size, lastModified, isLatest) with per-version Download/Delete row actions.
- [ ] A Tags editor (key/value rows) reads/writes object tagging via the admin endpoints; `userMetadata` shown read-only.
- [ ] Retention/legal-hold state shown + editable where object-lock is enabled (governance/compliance respected; compliance is read-only as enforced by the backend).
- [ ] All mutations confirm where destructive + toast; absent features show empty states.

## Tasks
- [TASK-1873] Add a Versions tab to the object sheet bound to the versions endpoint.
- [TASK-1874] Per-version Download/Delete actions (confirm + toast).
- [TASK-1875] Object Tags key/value editor (tagging endpoints) + read-only `userMetadata`.
- [TASK-1876] Retention/legal-hold panel (respect compliance/governance).
- [TASK-1877] i18n keys + empty states.

## Test plan
- [TEST-0614] E2E/manual: on a versioning-enabled bucket, versions list + per-version actions work; tags round-trip; retention edit blocked under compliance; toasts fire.

## Dependencies
- Blocks: _none_
- Blocked by: [STORY-0604], [STORY-0612]

## References
- UX review 2026-06-22 (power-user E; feature-gap table).
- `apps/openbucket-frontend/src/app/objects/object-browser.component.ts` (detail sheet), `libs/api-client` (new endpoints), `domain/objects/object.service.ts`.
