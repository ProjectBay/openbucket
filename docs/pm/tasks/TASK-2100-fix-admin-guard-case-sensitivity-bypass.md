---
id: TASK-2100
title: Fix admin-guard case-sensitivity auth bypass and make the guard fail-closed
story: STORY-0700
status: ready
type: implementation
size: M
---

## Description
Remediate audit finding [1] (CRITICAL, CWE-178 Improper Handling of Case Sensitivity → CWE-289 Authentication Bypass by Alternate Name). `JwtAuthGuard` is the sole auth boundary for `/api/admin/*` and decides whether to enforce auth with a case-sensitive prefix test, but Express 5 routes case-insensitively by default, so a mixed-case admin path (`/api/Admin/backup`) is matched to the real admin handler while the guard skips JWT verification and lets the handler run with no `req.user`. This exposes whole-instance backup download, bucket CRUD, and S3 access-key minting to any anonymous caller. Make the security decision case-insensitive (fail-closed), align the request classifier, and add strict/case-sensitive routing as defense-in-depth.

## Files to create / modify
- `libs/nestjs/src/lib/admin/auth/jwt-auth.guard.ts` — modify: lowercase `req.path` before the admin-prefix test at line 51 so any path Express routes to an admin handler is recognized as admin and requires JWT.
- `libs/nestjs/src/lib/common/middleware/request-classifier.middleware.ts` — modify: apply the identical case-insensitive normalization to the `/api/admin` and `/admin` prefix tests (lines 45, 51) so `ctx.kind` agrees with routing.
- `apps/openbucket-backend/src/main.ts` — modify: enable `expressInstance.set('case sensitive routing', true)` and `expressInstance.set('strict routing', true)` on the Express instance (near the existing `disable('x-powered-by')` / `disable('etag')` block) so mixed-case paths 404 instead of silently matching admin handlers.
- `libs/nestjs/src/lib/admin/auth/jwt-auth.guard.spec.ts` — modify/new: regression cases asserting mixed-case admin paths without a bearer are rejected.

## Implementation notes
- Vulnerable code, `jwt-auth.guard.ts:51`:
  ```ts
  if (!req.path.startsWith(this.adminPrefix)) return true;
  ```
  where `this.adminPrefix = `${options?.mountPath ?? ''}/api/admin/`` (constructed lowercase at line 41). Express never has `case sensitive routing` enabled (`main.ts` sets `trust proxy`, `x-powered-by`, `etag` only), so `GET /api/Admin/backup` is routed to `BackupController.instanceBackup` (`backup.controller.ts:29`, `@Controller('api/admin')`), yet `req.path === '/api/Admin/backup'` does not start with `'/api/admin/'`, the guard returns `true`, and the handler streams the backup with `req.user` unset. The bug is fail-OPEN.
- Minimal, complete fail-closed fix (`adminPrefix` is already lowercase):
  ```ts
  if (!req.path.toLowerCase().startsWith(this.adminPrefix)) return true;
  ```
  This is safe: the only routes literally under `/api/admin/` are the admin controllers, so lowercasing can only cause MORE requests to be authenticated, never fewer.
- Apply the same lowercase normalization in the classifier so `ctx.kind` (read by both `JwtAuthGuard` and `SigV4Guard`) matches routing:
  ```ts
  if (path === '/api/admin' || path.toLowerCase().startsWith('/api/admin/')) { ... }
  ```
  (and likewise for the `/admin` SPA branch).
- Defense-in-depth: enable strict, case-sensitive routing on the adapter so mixed-case paths 404 rather than resolving to admin handlers. S3 access keys are already case-sensitive and bucket labels are lowercase-only (`BUCKET_LABEL` regex), so this does not regress S3 semantics.
- CWE: CWE-178 (→ CWE-289). Verdict CONFIRMED, fail-open, unauthenticated full admin-surface takeover plus data exfiltration.

## Acceptance criteria
- [ ] `GET /api/Admin/backup`, `/api/ADMIN/buckets`, `/API/ADMIN/keys` without a bearer token each return 401 (was 200).
- [ ] `GET /api/admin/buckets` with a valid bearer still returns 200 (no regression on the canonical lowercase path).
- [ ] `RequestClassifierMiddleware` sets `ctx.kind = 'admin'` for the mixed-case admin paths above.
- [ ] With strict/case-sensitive routing enabled, a mixed-case admin path resolves to 404 or 401, never to an executed admin handler with `req.user` undefined.
- [ ] `nx test nestjs --testPathPattern=jwt-auth.guard.spec.ts` passes with the new regression cases.

## Test obligations
- Unit: `jwt-auth.guard.spec.ts` — mixed-case path is treated as admin and rejected without a token; classifier spec asserts `kind: 'admin'` on mixed case.
- E2E: covered by [TEST-0700] (cases 1–4).
- Conformance: N/A.

## Dependencies
- Blocked by: [STORY-0407] (`JwtAuthGuard`), [STORY-0007] (`RequestClassifierMiddleware`).
- Blocks: [TASK-2101], [TASK-2102] and the remainder of EPIC-08 — this is the P0 that ships first.

## References
- Audit finding [1] (CRITICAL, CWE-178/CWE-289).
- `docs/WHITEPAPER.md` §5.3 (`JwtAuthGuard`), §1.2.3 (Express bootstrap / body parsing), §1.5 (request classification).
- `libs/nestjs/src/lib/admin/auth/jwt-auth.guard.ts:41,51`; `libs/nestjs/src/lib/common/middleware/request-classifier.middleware.ts:45,51`; `libs/nestjs/src/lib/admin/backup/backup.controller.ts:25,29`; `apps/openbucket-backend/src/main.ts`.
