---
id: TASK-3024
title: Regenerate the API client and extend the audit catalogue
story: STORY-1002
status: backlog
type: infra
size: S
---

## Description
Wire the new admin-users surface into the shared contracts: regenerate the
OpenAPI-derived `@openbucket/api-client` so the console gets a typed
`AdminUsersService`, and extend the `AuditService` event catalogue with the four
admin-user events so callers ([TASK-3022]) use canonical names. This is the
integration glue that unblocks the console ([TASK-3023]).

## Files to create / modify
- `libs/nestjs/src/lib/admin/audit/audit.service.ts` — modify (append the four events to the catalogue doc-comment).
- `@openbucket/api-client` generated sources (e.g. `libs/api-client/src/**` / `apps/openbucket-frontend`'s generated client) — regenerate.
- `docs/WHITEPAPER.md` — modify (§5 admin plane: document multi-admin roles, the read-only allowlist, and the anti-lockout invariant).

## Implementation notes
- **Client regen**: the console consumes a codegen client (imports from
  `@openbucket/api-client`, e.g. `KeysAdminService`, `CreateKeyDto`). After
  [TASK-3022] adds the `/api/admin/users` routes with `@ApiOperation` operationIds
  and the DTOs are exported to Swagger, run the existing OpenAPI export + client
  generation target (the same pipeline that produced `KeysAdminService`). Confirm
  the emitted client contains `AdminUsersService` with `listAdminUsers`,
  `createAdminUser`, `updateAdminUser`, `deleteAdminUser` and the
  `AdminUserSummaryDto` / `CreateAdminUserDto` / `UpdateAdminUserDto` models, and
  that `MeResponseDto` now carries `role`.
- **Audit catalogue**: append to the table in `audit.service.ts` (names callers
  MUST use), keeping the existing `| Event | Emitted when | Required fields |`
  shape:
  ```
  | admin.user.created         | admin user created        | subject, target, role           |
  | admin.user.role.changed    | admin role reassigned     | subject, target, from, to       |
  | admin.user.password.reset  | admin password reset by peer | subject, target             |
  | admin.user.deleted         | admin user deleted        | subject, target                 |
  ```
  `subject` = the acting admin's username; `target` = the affected username
  (consistent with the existing `subject`-is-actor convention). Read-only `GET`
  list calls remain unaudited (per the v1 "reads are not audited" rule already
  documented in the file).
- **Whitepaper**: extend §5 (admin plane) to describe the `role` column, the
  `RolesGuard` default-deny-by-method model + self-service allowlist, the
  fresh-read enforcement, and the last-admin / no-self-delete invariants, so the
  library and standalone docs stay in sync.
- Edge cases: keep the generated client a pure re-export (no hand edits) so it
  stays regenerable; if the generator is not run in CI, note the manual command in
  the PR. No new runtime dependency is introduced.

## Acceptance criteria
- [ ] `nx build openbucket-frontend` compiles against the regenerated client
      importing `AdminUsersService`.
- [ ] The OpenAPI JSON export lists the four `/api/admin/users` operations and the
      `role` field on `MeResponseDto`.
- [ ] `audit.service.ts` catalogue documents the four `admin.user.*` events.
- [ ] `docs/WHITEPAPER.md` §5 describes multi-admin roles and the invariants.

## Test obligations
- Unit: covered by [TEST-1002] case 16 (client surface assertion / OpenAPI snapshot).
- E2E: N/A — infra/glue.
- Conformance: N/A.

## Dependencies
- Blocked by: [TASK-3022].
