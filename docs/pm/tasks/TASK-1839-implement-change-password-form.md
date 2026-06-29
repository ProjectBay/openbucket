---
id: TASK-1839
title: Implement change-password.component.ts (hlm form) → SettingsAdminService.changePassword + notify + inline validation
story: STORY-0607
status: done
type: implementation
size: M
---

## Description
Implement the change-password screen (currently an `export {};` stub). Build a reactive form on the design-system form primitives — current password, new password, confirm — with inline validation, submitting to `SettingsAdminService.changePassword`. Success and failure are reported via the shared `notify` toast.

## Files to create / modify
- `apps/openbucket-frontend/src/app/settings/change-password.component.ts` — replace stub (currently `export {};`)

## Implementation notes
- The DTO is `ChangePasswordDto { currentPassword: string; newPassword: string }` (`libs/api-client/src/lib/model/change-password-dto.ts`). The API method is `SettingsAdminService.changePassword(changePasswordDto: ChangePasswordDto, observe?, reportProgress?, options?): Observable<any>` POSTing to `/api/admin/settings/change-password` (`libs/api-client/src/lib/api/settings-admin.service.ts`).
- Build a standalone component with a `ReactiveFormsModule` `FormGroup`: `currentPassword`, `newPassword`, `confirmPassword`, all `Validators.required` (+ a `minLength` on `newPassword`); add a group-level validator that `confirmPassword === newPassword`. Render fields with `HlmInputImports` (`@openbucket/spartan-ui/input`), `HlmLabelImports` (`@openbucket/spartan-ui/label`), and `HlmFormFieldImports` (`@openbucket/spartan-ui/form-field` — `HlmFormField, HlmError, HlmHint`) for inline error text; submit with an `hlmBtn` button disabled while invalid/submitting.
- On submit, call `inject(SettingsAdminService).changePassword({ currentPassword, newPassword })`; on success `notify.success(...)` and reset the form; on error `notify.error(...)` with a sensible message (do not leak raw error objects). Import `notify` from `apps/openbucket-frontend/src/app/shared/ui/notify.ts` (STORY-0600). Only `currentPassword` + `newPassword` go on the wire — `confirmPassword` is client-side only.
- Validation surfaces as inline `hlm-error` text under each field, not just on submit.

## Acceptance criteria
- [ ] `nx build openbucket-frontend` and `nx lint openbucket-frontend` pass (Node 23).
- [ ] The form renders three password fields with inline validation; Submit is disabled until valid.
- [ ] Submitting a valid form POSTs `{ currentPassword, newPassword }` via `SettingsAdminService.changePassword` and fires a success toast on 2xx.
- [ ] A failed change fires an error toast (no raw error object shown); confirm-mismatch blocks submit with an inline error.

## Test obligations
- Unit: covered by [TEST-0607] (validation + submit-disable; mapping to `ChangePasswordDto`).
- E2E: covered by [TEST-0607] (manual: success/failure toasts).
- Conformance: N/A.

## Dependencies
- Blocked by: [STORY-0600], [STORY-0602], [TASK-1835]

## References
- UX review 2026-06-22 (IA — account/change-password; interaction — form feedback).
- `apps/openbucket-frontend/src/app/settings/change-password.component.ts`, `libs/api-client/src/lib/api/settings-admin.service.ts` (`changePassword`), `libs/api-client/src/lib/model/change-password-dto.ts` (`ChangePasswordDto`), `libs/ui/spartan/{input,label,form-field,button}`, `apps/openbucket-frontend/src/app/shared/ui/notify.ts` (STORY-0600).
- Interfaces consumed: `notify` (STORY-0600), `SettingsAdminService.changePassword`.
