---
id: TASK-1856
title: Implement key-secret-once-dialog.component.ts (copy + warning, focus the secret)
story: STORY-0611
status: done
type: implementation
size: M
---

## Description
Replace the `key-secret-once-dialog.component.ts` stub (`export {};`) with the dialog that shows a newly-created key's secret exactly once. It displays the access key ID + the one-time `secretAccessKey` with copy-buttons, a prominent "this won't be shown again" warning, and moves focus to the secret on open.

## Files to create / modify
- `apps/openbucket-frontend/src/app/keys/key-secret-once-dialog.component.ts` — replace stub (standalone, OnPush)

## Implementation notes
- Build on `HlmDialogImports` from `@openbucket/spartan-ui/dialog`. Opened programmatically via `HlmDialogService.open(component, { context })` from the create flow (TASK-1855), receiving the `CreatedKeyDto` as the dialog context (`{ id, accessKeyId, secretAccessKey, label, role, createdAt }`). Read the context via the brain dialog context injection (`injectBrnDialogContext`) or a passed input.
- Display:
  - Access Key ID (`accessKeyId`) in a monospace field with `<ob-copy-button [value]="created.accessKeyId" />`.
  - Secret (`secretAccessKey`) in a monospace field with `<ob-copy-button [value]="created.secretAccessKey" />` (`CopyButtonComponent`, STORY-0600).
  - A destructive/warning `hlmAlert variant="destructive"` (`@openbucket/spartan-ui/alert`) stating the secret will not be shown again — copy it now.
- Accessibility: move focus to the secret field (or its copy-button) on open via `afterNextRender`/a `@ViewChild` `focus()`. The "Done"/close button uses `hlmBtn` and `HlmDialogClose`. Optionally call `StatusAnnouncer.announce('Access key created — copy the secret now', 'assertive')` (STORY-0600) so screen-reader users are told the secret is one-time.
- This dialog never re-fetches the secret (the API does not return it again — `KeySummaryDto` has no `secretAccessKey`); it only renders what `CreatedKeyDto` carried.

## Acceptance criteria
- [ ] `nx build openbucket-frontend` and `nx lint openbucket-frontend` pass (Node 23).
- [ ] After creating a key, the secret-once dialog shows the access key ID + `secretAccessKey`, each with a working copy-button, plus a destructive "won't be shown again" warning.
- [ ] Focus lands on the secret (or its copy-button) on open; closing returns focus to the trigger (CDK).
- [ ] The dialog reads the secret only from the passed `CreatedKeyDto` (never re-fetches it).

## Test obligations
- Unit: N/A.
- E2E: covered by [TEST-0611] (secret shown once + copyable; warning present).
- Conformance: N/A.

## Dependencies
- Blocked by: [TASK-1855], [STORY-0600]

## References
- UX review 2026-06-22 (power-user C/F6 — one-time secret with copy + warning; a11y).
- `apps/openbucket-frontend/src/app/keys/key-secret-once-dialog.component.ts`, `libs/api-client` (`CreatedKeyDto.secretAccessKey`), `libs/ui/spartan/{dialog,alert,button}`, `shared/ui/{copy-button.component.ts,status-announcer.service.ts}` (STORY-0600).
- Interfaces consumed: `CopyButtonComponent`, `StatusAnnouncer`, `CreatedKeyDto`.
- Interfaces produced: `KeySecretOnceDialogComponent`.
