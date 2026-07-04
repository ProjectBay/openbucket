---
id: TASK-3012
title: Add effective-permissions inspection and single-action simulate endpoints
story: STORY-1001
status: backlog
type: implementation
size: M
---

## Description
Add read-only inspection so an operator can see exactly what a key can do:
`GET /api/admin/keys/:id/effective-permissions` returns the compiled scope and an
allow/deny matrix, and `POST /api/admin/keys/:id/simulate` answers a single
`{ action, resource }`. Both reuse the EPIC-08 evaluator
(`s3/authz/policy-evaluator.ts` `evaluatePolicy`) with the same `defaultAllow`
rule the S3 path uses, so the console and the real request path never disagree.

## Files to create / modify
- `libs/nestjs/src/lib/admin/keys/dto/effective-permissions.dto.ts` — new. Response DTO (`scoped`, `scope`, `matrix[]`).
- `libs/nestjs/src/lib/admin/keys/dto/simulate.dto.ts` — new. Request (`action`, `resource`) + response (`decision`) DTOs.
- `libs/nestjs/src/lib/admin/keys/keys-admin.controller.ts` — modify. Add `@Get(':id/effective-permissions')` and `@Post(':id/simulate')`.
- `libs/nestjs/src/lib/domain/keys/key.service.ts` — modify. Add a `findById(id)` helper returning the row (with `scope`, `role`) for the controller to evaluate.
- `libs/nestjs/src/lib/admin/keys/keys-admin.module.ts` — modify only if a helper provider is needed (evaluation is a pure call — no new provider expected).

## Implementation notes
- Reuse verbatim — do **not** re-implement matching: `import { evaluatePolicy } from '../../s3/authz/policy-evaluator'` and `import { operationToAction } from '../../s3/authz/operation-action'`. The matrix must match `PolicyAuthorizationGuard`'s decision exactly.
- `defaultAllow` rule (mirror the guard, `policy-authorization.guard.ts:57`): `role === 'root'` → `{ defaultAllow: true }` (root reports allow everywhere, `scoped: false`); `role === 'scoped'` → `{ defaultAllow: false }` (implicit deny outside scope). Same rule in both endpoints.
- Effective-permissions matrix: build it from a fixed action catalogue (the distinct `s3:*` values reachable via `operationToAction` — `s3:GetObject`, `s3:PutObject`, `s3:DeleteObject`, `s3:ListBucket`, `s3:ListBucketMultipartUploads`, `s3:AbortMultipartUpload`, `s3:GetBucketLocation`) crossed with the resources implied by the key's scope: for each scoped bucket, the bucket ARN `arn:aws:s3:::<bucket>` and a representative object ARN `arn:aws:s3:::<bucket>/<prefix>*`. For a root key, use a single representative resource row and report allow. Each cell: `{ action, resource, decision }` via `evaluatePolicy(scope, { action, resource, principal: accessKeyId, secureTransport: true, sourceIp: '0.0.0.0' }, opts)`.
  ```ts
  const ACTIONS = ['s3:GetObject','s3:PutObject','s3:DeleteObject','s3:ListBucket',
    's3:ListBucketMultipartUploads','s3:AbortMultipartUpload','s3:GetBucketLocation'] as const;
  interface EffectivePermissionsDto {
    scoped: boolean;
    scope: PolicyDocument | null;
    matrix: Array<{ action: string; resource: string; decision: 'allow' | 'deny' }>;
  }
  ```
- `simulate`: `SimulateSchema = z.object({ action: z.string().min(1).max(64), resource: z.string().min(1).max(2048) }).strict()`. Return `{ decision: evaluatePolicy(scope, {...}, opts) }`. Accept either a bare op name or an `s3:*` action — normalize via `operationToAction(action) ?? action` so an operator can type `GetObject` or `s3:GetObject`.
- Condition context: since these are hypothetical evaluations, default `secureTransport: true` and a benign `sourceIp` so `aws:SecureTransport`/`aws:SourceIp` conditions in a hand-written raw scope don't falsely deny; document this in the DTO (the matrix reflects action/resource reachability, not per-request network conditions). Optionally let `simulate` accept `secureTransport`/`sourceIp` overrides — keep them optional and bounded.
- Security / DoS: both are read-only and `JwtAuthGuard`-protected; the matrix size is bounded (≤ 20 buckets × 2 resources × 7 actions = 280 cells) by the scope caps in [TASK-3011], so no unbounded fan-out. `simulate` evaluates a single statement set — O(statements). Never mutate state; never surface the secret or hash. 404 when `id` is unknown (mirror `update`).
- Do not leak more than the compiled policy: the response echoes the same `scope` `PolicyDocument` already returned by the summary/create DTOs — no new secret material.

## Acceptance criteria
- [ ] `nx test nestjs --testPathPattern=keys-admin.controller` passes: for a key scoped to `tenant-a/`, the matrix shows `s3:GetObject` on `arn:aws:s3:::tenant-a/tenant-a/*`? — precisely, `allow` inside scope and `deny` on a non-scoped bucket/action; a root key shows `scoped:false` and all-allow.
- [ ] `simulate` returns `allow`/`deny` identical to what `PolicyAuthorizationGuard` would decide for the same action+resource+principal (asserted against a shared fixture with [TASK-3011]'s compiler).
- [ ] OpenAPI export contains `getKeyEffectivePermissions` and `simulateKeyAction` operationIds.
- [ ] Unknown `:id` returns 404; the endpoints never change key state.

## Test obligations
- Covered by [TEST-1001] (matrix correctness, simulate parity with the guard, root vs scoped `defaultAllow`).

## Dependencies
- Blocked by: [TASK-3011] (`scope` compilation + persistence), [STORY-1000] (`role: 'scoped'`, `defaultAllow: false` semantics). Reuses [STORY-0702] `evaluatePolicy`/`operationToAction`.
