---
id: STORY-0121
title: Object-lock enforcement on delete (WORM)
epic: EPIC-02
status: done
size: S
risk: medium
---

## User story
As a compliance operator, I want a delete of an object under retention or legal
hold to be **rejected**, so that object lock actually provides WORM protection
instead of being advisory metadata.

## Background
`docs/pm/S11-DECISIONS.md` (#2) found that object-lock mode/retention/legal-hold
were settable + gettable via the S3 API but **never enforced** — `deleteOne`
soft-deleted the row regardless, so a delete under active retention/legal-hold
succeeded. `docs/ARCHITECTURE.md` §10 states the intended semantics (governance =
admin override, compliance = no override), so this is completing intended work,
not a new decision.

## Description
Enforce object-lock on the **unversioned soft-delete** path of
`ObjectService.deleteOne` (the path that actually removes data):
- Legal hold on → `403 AccessDenied`.
- Active retention (`retainUntil > now`): `COMPLIANCE` → always `403`;
  `GOVERNANCE` → `403` unless root sends `x-amz-bypass-governance-retention: true`.
- Expired retention or no lock → delete proceeds.

Versioned deletes create a delete-marker (the locked version is retained), so
they are intentionally **not** gated (AWS semantics). `deleteObject` reads the
bypass header and threads it through; the bulk `DeleteObjects` path surfaces the
`AccessDenied` per-entry as `<Error>` rows (it does not bypass).

## Acceptance criteria
- [x] Delete under legal hold → `AccessDenied`.
- [x] Delete under COMPLIANCE retention → `AccessDenied` even with bypass.
- [x] Delete under GOVERNANCE retention → `AccessDenied` without bypass; succeeds
      with `x-amz-bypass-governance-retention: true`.
- [x] Expired retention / no lock → delete proceeds.

## Tasks
Implemented directly: `assertDeletable` in `object.service.ts` + `bypassGovernance`
threaded through `deleteOne`/`deleteObject`.

## Test plan
- Unit: `object-lock-enforcement.spec.ts` — 6 cases (legal-hold, compliance,
  governance ± bypass, expired, no-lock). Full objects suite green; lint clean.

## Dependencies
- Blocked by: [STORY-0115] (object-lock config/retention/legal-hold API).

## References
- `docs/pm/S11-DECISIONS.md` #2; `docs/ARCHITECTURE.md` §10.
- `apps/openbucket-backend/src/domain/objects/object.service.ts` (`deleteOne`,
  `assertDeletable`).
