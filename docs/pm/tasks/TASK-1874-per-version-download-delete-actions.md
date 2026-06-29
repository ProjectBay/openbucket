---
id: TASK-1874
title: Per-version Download/Delete row actions with confirm + toast
story: STORY-0614
status: done
type: implementation
size: S
---

## Description
Add per-row Download and Delete actions to the Versions table from TASK-1873. Download fetches a specific version's bytes; Delete removes a specific version (or delete marker) after a destructive confirmation, then refreshes the list. Both report outcomes via toast.

## Files to create / modify
- `apps/openbucket-frontend/src/app/objects/object-versions.component.ts` — modify (add row action buttons + handlers)
- `apps/openbucket-frontend/src/app/objects/object-browser.component.ts` — modify only if the delete/download handlers live on the parent (pass `(deleted)` / refresh callback)

## Implementation notes
- Each version row gets two icon buttons: `hlmBtn variant="ghost" size="icon"` (`@openbucket/spartan-ui/button`) with `lucideDownload` and `lucideTrash2` (`@ng-icons/lucide`); each carries `[attr.aria-label]` (e.g. "Download version" / "Delete version") so the icon-only controls have accessible names (WCAG 4.1.2) — required for the a11y rules re-enabled in STORY-0616.
- Download: reuse the existing authenticated-blob pattern from `object-browser.component.ts` `download()` (lines 206–216: `this.http.get(contentUrl, { responseType: 'blob' })` → `URL.createObjectURL` → anchor click → `URL.revokeObjectURL`), appending the `versionId` to the content URL query so the specific version's bytes are fetched.
- Delete: open the shared `ConfirmDialogComponent` (TASK-1801) with `destructive=true` and `title`/`description` naming the version; on confirm call `ObjectsAdminService.deleteObject(name, path, versionId, ...)` (the versioned delete from STORY-0612 / TASK-1861). On success `notify.success(...)` and re-call the versions load (TASK-1873); on failure `notify.error(...)`.
- Deleting a delete marker vs. a version: both go through the same versioned delete; label the confirm accordingly (i18n keys from TASK-1877).

## Acceptance criteria
- [ ] `nx build openbucket-frontend` and `nx lint openbucket-frontend` pass.
- [ ] Download on a version row fetches that version's bytes and triggers a browser download.
- [ ] Delete on a version row opens a destructive confirm; confirming deletes that version and refreshes the list with a success toast; cancel does nothing.
- [ ] Both buttons expose `aria-label`; failures surface via error toast.

## Test obligations
- Unit: covered by [TEST-0614] (delete calls deleteObject with versionId; refresh fires).
- E2E: covered by [TEST-0614] (manual: per-version download + delete).
- Conformance: N/A.

## Dependencies
- Blocked by: [TASK-1873], [STORY-0604], [STORY-0612]

## References
- UX review 2026-06-22 (power-user E — manage object history; F2 destructive confirm).
- `apps/openbucket-frontend/src/app/objects/object-browser.component.ts` (`download()` lines 206–216, `contentUrl()` lines 228–231), `libs/api-client/src/lib/api/objects-admin.service.ts` (`deleteObject` with `versionId`, STORY-0612).
- Interfaces consumed: `ConfirmDialogComponent` (TASK-1801), `notify` (TASK-1800).
