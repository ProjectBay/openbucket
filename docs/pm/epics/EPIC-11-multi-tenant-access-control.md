---
id: EPIC-11
title: Multi-tenant access control
status: backlog
whitepaper_section: "future — post-1.0 feature (extends §5.7, §2.3)"
owner_area: backend
---

## Objective

Unlock the SaaS-embedding audience by making access **scoped**. Today every access
key is hard-coded `role = 'root'` (see `access-key.entity.ts`), so anyone embedding
OpenBucket in a multi-tenant app must build their own isolation on top. This Epic
adds **scoped access keys** — a key restricted to a bucket or key-prefix — reusing
the bucket-policy evaluation engine shipped in EPIC-08, plus the management surface
(API + console) to mint and revoke them, and optional multi-admin roles. The result:
hand each tenant a key that can only touch their own prefix.

## Scope

- In scope:
  - **Scoped access keys** — attach an inline policy / allowed bucket+prefix to an
    access key; enforce it on the S3 path via the existing policy evaluator.
    [STORY-1000]
  - **Per-key policy management** — admin API + console to create/rotate/revoke keys
    with a scope, and inspect effective permissions. [STORY-1001]
  - **Admin roles** — more than one admin user, with at least a read-only vs
    full-admin distinction. [STORY-1002]
- Out of scope:
  - A full IAM (users, groups, roles, STS, assume-role) — this is bucket/prefix
    scoping, not a policy language expansion.
  - External identity providers (OIDC/SAML) — future.
  - Cross-account bucket sharing.

## Success criteria

- An access key scoped to `tenant-a/` can PUT/GET/LIST under that prefix and is
  denied (403) on any other bucket/prefix — enforced by the same evaluator used for
  bucket policies, verified by conformance-style tests.
- Root credentials remain unrestricted; scoping is additive and opt-in, so existing
  single-root deployments are unchanged.
- The console can mint a scoped key, show its scope, and revoke it; revocation takes
  effect immediately.
- A read-only admin user cannot perform state-changing admin operations.

## Stories

- [STORY-1000] Scoped access keys enforced via the policy evaluator — tasks TASK-3000..3009, test TEST-1000
- [STORY-1001] Per-key policy management API + console — tasks TASK-3010..3019, test TEST-1001
- [STORY-1002] Multi-admin users & roles — tasks TASK-3020..3029, test TEST-1002

## Dependencies

- Blocks: —
- Blocked by: [EPIC-08] STORY-0702 (bucket-policy evaluation engine) — this Epic
  reuses `s3/authz/policy-evaluator.ts`.

## References

- `libs/nestjs/src/lib/persistence/entities/access-key.entity.ts` (`role = 'root'`),
  `admin/keys/`, `s3/authz/policy-evaluator.ts`, `s3/sigv4/sigv4.guard.ts`,
  `admin/auth/` (admin users).
