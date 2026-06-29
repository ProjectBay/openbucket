---
id: TASK-1866
title: Backend unit specs for each new admin controller method
story: STORY-0612
status: done
type: implementation
size: M
---

## Description
Add unit specs covering every new controller method from [TASK-1858..1863] — the thin-adapter mapping (request DTO → domain call → response DTO) and the audit emit on each mutation. Follow the existing `buckets-admin.controller.spec.ts` pattern exactly: hand-built mock services, a fake `req` carrying `{ openbucket:{requestId}, user:{username} }`, no Nest TestingModule needed (the controllers are plain classes).

## Files to create / modify
- `apps/openbucket-backend/src/admin/buckets/buckets-admin.controller.spec.ts` — modify (versioning/tagging/encryption/lifecycle/cors/object-lock/policy cases)
- `apps/openbucket-backend/src/admin/objects/objects-admin.controller.spec.ts` — modify (batchDelete/versions/tagging/retention/legal-hold/presign cases)

## Implementation notes
- Mirror the existing spec's `build()` factory: `const buckets = { ...jest.fn() }; const objects = { ...jest.fn() }; const audit = { emit: jest.fn() };` then `new BucketsAdminController(buckets as unknown as BucketService, objects as unknown as ObjectService, audit as unknown as AuditService)`. The fake request is `const req = { openbucket: { requestId: 'req-1' }, user: { username: 'admin' } } as unknown as Request;`.
- For each new method, assert three things (the existing cases 2/4 model this):
  1. the controller calls the correct domain method with the mapped args (e.g. `expect(buckets.<method>).toHaveBeenCalledWith(...)`),
  2. the returned DTO is the expected JSON shape (ISO dates, number sizes, `{deleted,errors}` / `{versions,deleteMarkers}` / `{url,expiresAt}`),
  3. mutations call `audit.emit` with the catalogued event + `subject:'admin'` + `requestId:'req-1'`; reads do NOT emit (case 5 models "no audit on the error path").
- Error-path cases: a missing bucket/key surfaces `NotFoundException` / domain `NoSuchKeyError`; encryption with a non-`AES256` algorithm rejects (domain `InvalidArgument`); these propagate and do NOT emit audit (mirror existing case 5 `BucketNotEmptyError` not-swallowed).
- Presign ([TASK-1863]) round-trip: feed the generated URL into the real `verifyPresigned` (with a stub `KeyService` returning a known secret) and assert it returns `true` — proves sign/verify symmetry. Also assert `expiresIn` cap at `MAX_EXPIRES`.
- Use a stable injected `now` (fake timer or injected clock) for `expiresAt`/`X-Amz-Date` determinism if the generator reads `Date.now()` directly.
- Run on **Node 20**: `nx test openbucket-backend --testPathPatterns=buckets-admin.controller.spec` and `--testPathPatterns=objects-admin.controller.spec` (plural `--testPathPatterns` per `[[project_jest30_testpathpatterns]]`; the singular flag is silently ignored and runs the whole suite).

## Acceptance criteria
- [ ] `nx test openbucket-backend --testPathPatterns=buckets-admin.controller.spec` (Node 20) passes with the new bucket-config cases.
- [ ] `nx test openbucket-backend --testPathPatterns=objects-admin.controller.spec` (Node 20) passes with the new object cases incl. the presign verify round-trip.
- [ ] Every new mutation has an audit-emit assertion; every read has a no-emit assertion; every method has a mapped-args assertion.

## Test obligations
- Unit: this IS [TEST-0612]'s unit layer.
- E2E: covered by [TEST-0612] (separate e2e cases).
- Conformance: N/A.

## Dependencies
- Blocked by: [TASK-1858], [TASK-1859], [TASK-1860], [TASK-1861], [TASK-1862], [TASK-1863]

## References
- `apps/openbucket-backend/src/admin/buckets/buckets-admin.controller.spec.ts` (the `build()`/`req` pattern + cases 1–5 — model verbatim), `s3/sigv4/presigned.ts` (`verifyPresigned`, `MAX_EXPIRES`).
- See `[[project_jest30_testpathpatterns]]`, `[[project_node20_persistence]]`, `[[project_admin_api_spec_drift]]`.
