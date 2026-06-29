---
id: TASK-0633
title: Implement `invalidate`, `reloadRootFromEnv`, and `redact`
story: STORY-0212
status: done
type: implementation
size: XS
---

## Description
Add the cache-invalidation hook called by the admin module on key updates, the emergency root-key rotation hook, and the `redact(id)` helper used in log messages to avoid leaking access-key ids in plaintext logs.

## Files to create / modify
- `apps/openbucket-backend/src/storage/key.service.ts` — modify (append methods + helper)

## Implementation notes
- `invalidate(accessKeyId: string): void` (verbatim from §3.10):
  ```ts
  const cached = this.cache.get(accessKeyId);
  if (cached?.isRoot) return;
  this.cache.delete(accessKeyId);
  ```
  Rationale (§3.10): root key is bound to boot env and never invalidated through this API; admin-driven sub-key updates go through this method.
- `reloadRootFromEnv(): void` (verbatim from §3.10):
  ```ts
  const rootId = this.config.getOrThrow<string>('ROOT_ACCESS_KEY_ID');
  const rootSecret = this.config.getOrThrow<string>('ROOT_SECRET_ACCESS_KEY');
  for (const [id, entry] of this.cache) {
    if (entry.isRoot) this.cache.delete(id);
  }
  this.cache.set(rootId, { accessKeyId: rootId, secret: rootSecret, disabled: false, isRoot: true });
  ```
- `function redact(id: string): string` (verbatim from §3.10):
  ```ts
  if (id.length <= 8) return '****';
  return `${id.slice(0, 4)}…${id.slice(-2)}`;
  ```
- Per §3.10 closing paragraph: "Cache invalidation on admin-side updates (disable, delete) is the admin module's responsibility — it calls `KeyService.invalidate(accessKeyId)` inside the same transaction that mutates the `access_keys` row."

## Acceptance criteria
- [ ] `invalidate(rootId)` is a no-op — `getSecret(rootId)` continues to return the cached entry.
- [ ] `invalidate(subKeyId)` deletes the cache entry — next `getSecret` re-reads from DB.
- [ ] `reloadRootFromEnv()` after `ConfigService` has been mutated to new env values reflects the new root in the cache.
- [ ] `redact('AKIAIOSFODNN7EXAMPLE')` returns `'AKIA…LE'`; `redact('short')` returns `'****'`.

## Test obligations
- Unit: covered by [TEST-0212]
- E2E: N/A
- Conformance: N/A

## Dependencies
- Blocked by: [TASK-0632]

## References
- `docs/WHITEPAPER.md` §3.10 (lines 4910–4953)
