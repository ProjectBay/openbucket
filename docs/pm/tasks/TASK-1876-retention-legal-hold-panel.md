---
id: TASK-1876
title: Retention/legal-hold panel respecting compliance/governance
story: STORY-0614
status: done
type: implementation
size: M
---

## Description
Add a Retention & Legal-hold panel to the object detail sheet for buckets with object-lock enabled. It shows the current retention mode (GOVERNANCE/COMPLIANCE) + retain-until date and the legal-hold ON/OFF state, and lets the operator edit them via the admin retention/legal-hold endpoints (STORY-0612) — with COMPLIANCE-mode retention rendered read-only because the backend forbids shortening it.

## Files to create / modify
- `apps/openbucket-frontend/src/app/objects/object-retention.component.ts` — new (standalone, OnPush panel)
- `apps/openbucket-frontend/src/app/objects/object-browser.component.ts` — modify (add the panel to the detail sheet, shown only when object-lock is enabled)

## Implementation notes
- Read current state via `ObjectsAdminService.getObjectRetention(name, path, ...)` and `getObjectLegalHold(name, path, ...)` (STORY-0612 / TASK-1862). Edit via `putObjectRetention(name, path, body, ...)` and `putObjectLegalHold(name, path, body, ...)`.
- Retention mode select uses `hlm-select` (`@openbucket/spartan-ui/select`) with `GOVERNANCE` / `COMPLIANCE`; retain-until uses the existing `hlm-date-picker` (`@openbucket/spartan-ui/date-picker`, already configured in `app.config.ts` via `provideHlmDatePickerConfig`).
- Compliance enforcement: when current mode is `COMPLIANCE`, render the retention controls read-only (S3 compliance retention cannot be shortened/removed; the backend rejects it). GOVERNANCE retention and legal-hold remain editable. Surface a backend rejection (e.g. attempting to bypass without permission) via `notify.error(...)` rather than failing silently — matches the story AC "compliance is read-only as enforced by the backend".
- Legal-hold is a toggle (`HlmSwitch`, `@openbucket/spartan-ui/switch`) calling `putObjectLegalHold` with `{ status: 'ON' | 'OFF' }`; mutations confirmed only where destructive is not required (legal-hold toggle is non-destructive → toast, no confirm; reducing/removing governance retention → destructive confirm via `ConfirmDialogComponent`, TASK-1801).
- Panel is hidden entirely when object-lock is not enabled on the bucket; show the empty state ("Object lock not enabled") from TASK-1877.
- `OnPush`.

## Acceptance criteria
- [ ] `nx build openbucket-frontend` and `nx lint openbucket-frontend` pass.
- [ ] Retention mode + retain-until and legal-hold render from the endpoints when object-lock is enabled; the panel is hidden/empty otherwise.
- [ ] COMPLIANCE-mode retention is read-only; GOVERNANCE retention and legal-hold are editable and persist via the endpoints with a toast.
- [ ] A backend rejection (e.g. compliance shortening) surfaces an error toast, not a silent failure.

## Test obligations
- Unit: covered by [TEST-0614] (compliance → controls disabled; legal-hold toggle maps to ON/OFF).
- E2E: covered by [TEST-0614] (manual: retention edit blocked under compliance).
- Conformance: N/A.

## Dependencies
- Blocked by: [STORY-0604], [STORY-0612]

## References
- UX review 2026-06-22 (power-user E — compliance management from the console).
- `libs/api-client/src/lib/api/objects-admin.service.ts` (`getObjectRetention`/`putObjectRetention`/`getObjectLegalHold`/`putObjectLegalHold`, STORY-0612), `libs/ui/spartan/{select,date-picker,switch}`, `apps/openbucket-frontend/src/app/app.config.ts` (`provideHlmDatePickerConfig`).
- Interfaces consumed: retention/legal-hold endpoints (STORY-0612), `ConfirmDialogComponent` (TASK-1801), `notify` (TASK-1800).
