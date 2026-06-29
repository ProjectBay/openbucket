---
id: STORY-0212
title: `KeyService.getSecret` interface for SigV4 lookup
epic: EPIC-03
status: done
size: S
risk: medium
---

## User story
As a developer building the SigV4 guard ([EPIC-02]), I want `KeyService.getSecret(accessKeyId)` to return a `KeyLookupResult | null` from an in-memory cache seeded with the root pair at boot and to fall through to SQLite for sub-keys, so that signature verification has a single, fast, cache-invalidatable lookup that returns `null` for both unknown *and* disabled keys without leaking the distinction to the caller.

## Description
Implement `KeyService` per §3.10. `onModuleInit` loads `ROOT_ACCESS_KEY_ID`/`ROOT_SECRET_ACCESS_KEY` from `ConfigService` and pre-populates the cache with `{ secret, disabled: false, isRoot: true }`. `getSecret(accessKeyId)`: cache hit → return entry (or `null` if disabled); miss → look up in `access_keys`; v1: every miss returns `null` with a `log.warn(...)` (sub-key plaintext path is forward-compatible only). `invalidate(accessKeyId)` clears non-root cache entries; `reloadRootFromEnv()` is provided for test and emergency rotation. This is the contract consumed by EPIC-02's SigV4 guard.

## Acceptance criteria
- [x] `KeyService` is `@Injectable()` and implements `OnModuleInit`.
- [x] On module init, the root pair is loaded from `ConfigService.getOrThrow('ROOT_ACCESS_KEY_ID')` and `('ROOT_SECRET_ACCESS_KEY')` and cached (TEST-0212 case 1).
- [x] `getSecret(rootId)` returns the cached entry (case 1); `getSecret('unknown')` returns `null` (case 2).
- [x] A cached-disabled hit returns `null` without touching SQLite (case 4, spy on `em.findOne` asserts zero calls).
- [x] `invalidate(rootId)` is a no-op (case 5); `invalidate(subKeyId)` drops the cache entry (case 6).
- [x] `reloadRootFromEnv()` purges the old root entry and loads the new env values (case 7).
- [x] No log line in the suite contains the plaintext secret (case 9); the redacted-id form is logged (case 3) and `redact` short/long behaviour (case 8).

## Tasks
- [TASK-0632] Implement `KeyService.getSecret` with cache + DB miss path
- [TASK-0633] Implement `invalidate`, `reloadRootFromEnv`, and `redact`

## Test plan
- [TEST-0212] `KeyService` behaviour and cache discipline

## Dependencies
- Blocks: [EPIC-02] (SigV4 guard consumes this interface)
- Blocked by: [STORY-0203], [STORY-0205]

## References
- `docs/WHITEPAPER.md` §3.10 (lines 4829–4953)
- Interfaces produced (consumed by [EPIC-02] `SigV4Guard`):
  - `getSecret(accessKeyId: string): Promise<KeyLookupResult | null>`
  - `invalidate(accessKeyId: string): void`
  - `reloadRootFromEnv(): void`
  - `KeyLookupResult { accessKeyId: string; secret: string; disabled: boolean; isRoot: boolean }`
