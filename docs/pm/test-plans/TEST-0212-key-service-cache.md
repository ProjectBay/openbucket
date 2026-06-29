---
id: TEST-0212
title: `KeyService` behaviour and cache discipline
covers: [STORY-0212, TASK-0632, TASK-0633]
status: done
level: unit
---

## Goal
Verify `KeyService` loads the root pair from env on `onModuleInit`, returns cached results, returns `null` for unknown / disabled keys without leaking which case fired, falls through to `access_keys` for sub-key misses (always returning `null` in v1 with a warning), and supports `invalidate`/`reloadRootFromEnv`.

## Setup
- Real `:memory:` SQLite; initial migration applied.
- `ConfigService` stub returning `ROOT_ACCESS_KEY_ID=AKIAEXAMPLE` and `ROOT_SECRET_ACCESS_KEY=secretvalue`.
- Inject `KeyService` and call `onModuleInit()` manually.

## Cases
1. After `onModuleInit`, `await getSecret('AKIAEXAMPLE')` returns `{ accessKeyId: 'AKIAEXAMPLE', secret: 'secretvalue', disabled: false, isRoot: true }`.
2. `await getSecret('unknown')` returns `null`; no DB row exists for `unknown`.
3. Insert `AccessKey { accessKeyId: 'subkey', secretHash: '<hash>', disabled: false }`. `await getSecret('subkey')` returns `null` (v1 has no plaintext path); `log.warn` was called with substring `'sub-key support not enabled in v1'` and the redacted id.
4. Insert `AccessKey { accessKeyId: 'AKIAOTHER', secretHash: '<hash>', disabled: true }` and pre-populate the cache as `{ disabled: true }`. `await getSecret('AKIAOTHER')` returns `null`. Spy on `em.findOne` and verify it is *not* called (cache served the disabled hit).
5. `invalidate('AKIAEXAMPLE')` (root key) is a no-op; `await getSecret('AKIAEXAMPLE')` still returns the cached root entry.
6. `invalidate('subkey')` removes the cache entry; next `getSecret('subkey')` re-queries the DB.
7. Mutate `ConfigService` to return new env values and call `reloadRootFromEnv()`. The old root id no longer resolves via `getSecret`; the new root id does.
8. `redact('AKIAIOSFODNN7EXAMPLE')` returns `'AKIA…LE'`; `redact('short')` returns `'****'`.
9. No log message in the suite contains the plaintext `'secretvalue'` (assert by searching all captured log lines).

## Tooling
- Framework: jest
- Runner: `nx test backend --testPathPattern=key.service.spec.ts`

## Pass criteria
- [x] All nine cases pass (`apps/openbucket-backend/src/storage/key.service.spec.ts`); backend suite 152/152.
- [x] No `EntityManager` mocks for the lookup paths — real `:memory:` SQLite. Case 4 uses `jest.spyOn(orm.em, 'findOne')` only to assert *zero* calls (a cache-discipline invariant), not to substitute behaviour.

## References
- `docs/WHITEPAPER.md` §3.10 (lines 4829–4953)
