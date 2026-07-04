---
id: TASK-3001
title: Add reversible secret storage so sub-keys can SigV4-authenticate
story: STORY-1000
status: backlog
type: implementation
size: M
---

## Description

Unblock the fundamental gap that makes scoped keys inert today:
`storage/key.service.ts#getSecret` returns `null` for every DB sub-key because
SigV4 needs a plaintext secret and the row only holds an argon2id hash. Add a
`SecretCipher` (AES-256-GCM) so a sub-key's secret is stored encrypted at rest and
recoverable on the hot path, then wire `getSecret` to decrypt it and surface the
key's scope + root-ness to the caller. The argon2id hash is retained for
defence-in-depth; the encrypted blob is what SigV4 consumes.

## Files to create / modify

- `libs/nestjs/src/lib/domain/keys/secret-cipher.ts` — new (`SecretCipher`
  service: `encrypt(plaintext): string`, `decrypt(blob): string`)
- `libs/nestjs/src/lib/domain/keys/secret-cipher.spec.ts` — new
- `libs/nestjs/src/lib/persistence/entities/access-key.entity.ts` — modify (add
  `secretEncrypted?: string | null`, nullable text)
- `libs/nestjs/src/lib/migrations/Migration20260704000001_access_key_scope.ts` — modify
  (add the `secret_encrypted` column in the same migration as `scope_policy`)
- `libs/nestjs/src/lib/domain/keys/key.service.ts` — modify (`create` also stores
  `secretEncrypted`)
- `libs/nestjs/src/lib/storage/key.service.ts` — modify (`getSecret` decrypts
  sub-keys; `KeyLookupResult` gains `scopePolicy` + `isRoot` already present)
- `libs/nestjs/src/lib/config/*` — modify (add `KEY_ENCRYPTION_SECRET` to the zod
  env schema, optional; derive from `ROOT_SECRET_ACCESS_KEY` via HKDF when unset)

## Implementation notes

- `SecretCipher` uses `node:crypto` `createCipheriv('aes-256-gcm', kek, iv)` with a
  random 12-byte IV per secret; serialize as `v1.<iv_b64>.<tag_b64>.<ct_b64>`.
  The 32-byte KEK is `hkdfSync('sha256', keyMaterial, salt='openbucket/kek/v1',
  info='access-key-secret', 32)` where `keyMaterial` is `KEY_ENCRYPTION_SECRET`
  if set else `ROOT_SECRET_ACCESS_KEY`. Document the operational caveat: rotating
  the root secret without setting `KEY_ENCRYPTION_SECRET` invalidates existing
  sub-key secrets (they must be re-minted) — a scoped-key ADR note.
- `domain/keys/key.service.ts#create`: after generating `secretAccessKey`, store
  BOTH `secretHash = argon2.hash(...)` (unchanged) and
  `secretEncrypted = cipher.encrypt(secretAccessKey)`. Extend `CreateKeyInput` /
  `CreatedKey` to carry the optional `scopePolicy` (JSON) produced by TASK-3000's
  compiler; the plaintext secret is still surfaced exactly once.
- `storage/key.service.ts#getSecret`: replace the current warn-and-return-null
  branch. When a DB row is found: `secret = cipher.decrypt(row.secretEncrypted)`;
  build `KeyLookupResult { accessKeyId, secret, disabled: row.disabled,
  isRoot: false, scopePolicy: row.scopePolicy ?? null }`. Cache exactly as today
  (including the `disabled: true` negative cache to avoid a SQLite flood), and keep
  `invalidate()` semantics. Decryption failure ⇒ log + return `null` (fail closed —
  treat as an unknown key, no timing distinction beyond the existing model).
- The `KeyLookupResult` interface already exists; add `isRoot` (already present) and
  `scopePolicy?: string | null`. The root entry set in `onModuleInit` gets
  `scopePolicy: null`.
- Security/DoS: never log plaintext or the KEK (reuse `redact`); GCM auth tag
  rejects tampering; decryption is CPU-cheap so no new DoS surface beyond the
  existing per-key SQLite lookup, which is already cached.

## Acceptance criteria

- [ ] `SecretCipher.decrypt(encrypt(s)) === s` and a tampered blob throws.
- [ ] A newly created sub-key can complete a real SigV4-signed request end to end.
- [ ] `getSecret` returns `isRoot: false` + the key's `scopePolicy` for a DB row and
      `isRoot: true`, `scopePolicy: null` for the env root key.
- [ ] Disabled sub-key still returns `null` from `getSecret`.
- [ ] `nx test nestjs --testPathPattern="secret-cipher|key.service"` passes.

## Test obligations

- Unit: covered by [TEST-1000] (cipher round-trip, getSecret branches)
- E2E: covered by [TEST-1000] (sub-key signs a request)
- Conformance: N/A

## Dependencies

- Blocked by: [TASK-3000] (entity/migration + scope column)
