---
id: TASK-1240
title: Document v1 audit event catalogue in AuditService JSDoc
story: STORY-0413
status: done
type: docs
size: XS
---

## Description
Add a JSDoc block above `AuditService.emit` enumerating the v1 event catalogue verbatim from §5.9, so callers don't drift on event names.

## Files to create / modify
- `apps/backend/src/admin/audit/audit.service.ts` — modify (add JSDoc)

## Implementation notes
- Document this catalogue verbatim from §5.9 (lines 7725–7741):

  | Event | Emitted when | Required fields |
  |---|---|---|
  | `admin.login` | successful login | `subject`, `ip` |
  | `admin.login.failed` | failed login attempt | `username`, `ip` (no `subject` if unknown) |
  | `admin.logout` | logout call | `subject` |
  | `admin.password.changed` | password rotated | `subject` |
  | `bucket.created` | new bucket | `subject`, `bucket` |
  | `bucket.deleted` | bucket dropped | `subject`, `bucket` |
  | `bucket.versioning.changed` | versioning toggled | `subject`, `bucket`, `from`, `to` |
  | `object.deleted` | object purge via admin | `subject`, `bucket`, `key` |
  | `key.created` | access key minted | `subject`, `keyId` |
  | `key.disabled` | access key disabled | `subject`, `keyId` |
  | `key.updated` | access key edited | `subject`, `keyId` |
  | `key.deleted` | access key removed | `subject`, `keyId` |
  | `settings.changed` | settings update | `subject`, `field` |

- Note in the JSDoc: read-only `GET` calls are not audited at v1.

## Acceptance criteria
- [ ] JSDoc above `emit` lists every event name from the §5.9 table.
- [ ] Required-fields column is captured per event.

## Test obligations
- Unit: covered by [TEST-0418]
- E2E: N/A
- Conformance: N/A

## Dependencies
- Blocked by: [TASK-1239]

## References
- `docs/WHITEPAPER.md` §5.9 (lines 7725–7744)
