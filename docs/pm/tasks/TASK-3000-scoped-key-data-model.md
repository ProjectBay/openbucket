---
id: TASK-3000
title: Add scoped-key data model, scope schema, and prefix-to-policy compiler
story: STORY-1000
status: backlog
type: implementation
size: M
---

## Description

Give an access key an optional **scope** without disturbing the root path. Add a
nullable `scopePolicy` column to the `AccessKey` entity holding a compiled
`PolicyDocument` (JSON text), define a zod `KeyScope` schema for the two authoring
forms (prefix form and inline-policy form), and provide a pure
`compileScopeToPolicy` function that turns a prefix scope into the same
`PolicyDocument` grammar the evaluator already understands. No enforcement here —
this Task only lands the data model and the compiler that later Tasks consume.

## Files to create / modify

- `libs/nestjs/src/lib/persistence/entities/access-key.entity.ts` — modify (add
  `scopePolicy?: string | null` column, `type: 'text'`, nullable, default null)
- `libs/nestjs/src/lib/domain/keys/key-scope.ts` — new (`KeyScope` zod schema +
  `compileScopeToPolicy` + `parseScopePolicy` helpers)
- `libs/nestjs/src/lib/domain/keys/key-scope.spec.ts` — new (compiler unit tests)
- `libs/nestjs/src/lib/migrations/Migration20260704000001_access_key_scope.ts` — new
- `libs/nestjs/src/lib/persistence/entities/types.ts` — modify (re-export/tighten
  `PolicyDocument` if the compiler needs a narrowed writer type)

## Implementation notes

- Entity column mirrors the existing nullable pattern (`lastUsedAt`):
  `@Property({ type: 'text', nullable: true }) scopePolicy?: string | null;`.
  Root keys are loaded from env and never persisted, so they can never carry a
  scope — the additive/opt-in guarantee holds structurally.
- `KeyScope` (nestjs-zod / `z`) is a discriminated union:
  - `{ kind: 'prefix', bucket: string, prefix?: string, actions?: string[] }`
  - `{ kind: 'policy', document: PolicyDocument }`
  Validate `bucket` against the same bucket-name rules used elsewhere; cap
  `prefix` length (e.g. ≤ 1024) and reject `..`/leading `/` to avoid ARN
  smuggling. Default `actions` to the read+write object set
  (`s3:GetObject`, `s3:PutObject`, `s3:DeleteObject`, `s3:ListBucket`).
- `compileScopeToPolicy(scope): PolicyDocument` for the prefix form emits two
  statements, both `Effect: 'Allow'`, `Principal: '*'` (principal is already
  pinned by the SigV4-resolved key — see TASK-3002):
  - object statement: `Resource: 'arn:aws:s3:::<bucket>/<prefix>*'`,
    `Action: [s3:GetObject, s3:PutObject, s3:DeleteObject]`
  - bucket statement: `Resource: 'arn:aws:s3:::<bucket>'`,
    `Action: [s3:ListBucket]`, plus a `Condition: { StringLike: { 's3:prefix':
    ['<prefix>*', '<prefix>'] } }` (the operator TASK-3004 teaches the evaluator).
  Escape any evaluator glob metacharacters (`*`, `?`) already present in the
  literal prefix before appending the trailing `*`, so a tenant prefix containing
  `*` cannot broaden its own grant.
- `parseScopePolicy(row.scopePolicy): PolicyDocument | null` — `JSON.parse` guarded
  by the `PolicyDocument` zod schema; on parse/validation failure return a
  **deny-everything** sentinel (empty `Statement: []`) and log, so a corrupt scope
  fails closed rather than opening access.
- Migration follows `Migration20260609000001` conventions: forward-only, `down()`
  restores the prior shape. The table is empty until the admin API mints a key, so
  a plain `alter table "access_keys" add column "scope_policy" text null;` is safe
  (no NOT NULL/UNIQUE constraint added) — no drop/recreate needed.
- Security/DoS: bound the serialized scope size (reject > 8 KiB) before persisting
  so a giant inline policy can't blow up per-request evaluation; the evaluator is
  O(statements × resources) per request.

## Acceptance criteria

- [ ] `AccessKey.scopePolicy` is nullable and defaults to null; existing rows and
      the root key are unaffected.
- [ ] `compileScopeToPolicy({kind:'prefix',bucket:'t-a',prefix:'tenant-a/'})`
      yields an object `Allow` on `arn:aws:s3:::t-a/tenant-a/*` and a bucket
      `Allow` on `arn:aws:s3:::t-a` gated by `StringLike s3:prefix`.
- [ ] A prefix containing a glob metacharacter is escaped and cannot widen the ARN.
- [ ] `parseScopePolicy` returns a deny-all document for malformed JSON.
- [ ] `nx test nestjs --testPathPattern=key-scope.spec` passes.

## Test obligations

- Unit: covered by [TEST-1000] (compiler + parser cases)
- E2E: covered by [TEST-1000]
- Conformance: N/A

## Dependencies

- Blocked by: [STORY-0702] (`PolicyDocument` grammar + evaluator)
