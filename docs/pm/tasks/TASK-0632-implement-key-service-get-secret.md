---
id: TASK-0632
title: Implement `KeyService.getSecret` with cache + DB miss path
story: STORY-0212
status: done
type: implementation
size: S
---

## Description
Implement the hot-path lookup the SigV4 guard ([EPIC-02]) consumes. Cache hit returns the entry (or `null` if disabled — disabled is cached so a flood does not hammer SQLite). Miss falls through to `access_keys`; in v1 every row miss returns `null` with a warning (sub-key plaintext path is intentionally unreachable).

## Files to create / modify
- `apps/openbucket-backend/src/storage/key.service.ts` — new (scaffold + `onModuleInit` + `getSecret`)

## Implementation notes
- Interface (verbatim from §3.10): `interface KeyLookupResult { accessKeyId: string; secret: string; disabled: boolean; isRoot: boolean; }`.
- Class skeleton:
  ```ts
  @Injectable()
  export class KeyService implements OnModuleInit {
    private readonly log = new Logger(KeyService.name);
    private readonly cache = new Map<string, KeyLookupResult>();
    constructor(
      private readonly em: EntityManager,
      private readonly config: ConfigService,
    ) {}
    ...
  }
  ```
- `onModuleInit(): void` (verbatim from §3.10):
  ```ts
  const rootId = this.config.getOrThrow<string>('ROOT_ACCESS_KEY_ID');
  const rootSecret = this.config.getOrThrow<string>('ROOT_SECRET_ACCESS_KEY');
  this.cache.set(rootId, { accessKeyId: rootId, secret: rootSecret, disabled: false, isRoot: true });
  this.log.log(`KeyService loaded root access key (id=${redact(rootId)})`);
  ```
- `async getSecret(accessKeyId: string): Promise<KeyLookupResult | null>` (verbatim from §3.10):
  ```ts
  const cached = this.cache.get(accessKeyId);
  if (cached) {
    return cached.disabled ? null : cached;
  }
  const row = await this.em.findOne(AccessKey, { accessKeyId });
  if (!row) return null;
  this.log.warn(
    `KeyService: accessKeyId=${redact(accessKeyId)} found in DB but no plaintext available — ` +
      'sub-key support not enabled in v1',
  );
  return null;
  ```
- `redact` is in [TASK-0633]; declare `function redact(id: string): string;` here (or move the function to a shared helper imported by both).
- Per §3.10: SigV4 verification requires plaintext — argon2id hash is one-way and cannot recover the secret. Root pair lives in memory only; future sub-keys will require envelope encryption (out of scope).

## Acceptance criteria
- [ ] Booting with `ROOT_ACCESS_KEY_ID=foo` and `ROOT_SECRET_ACCESS_KEY=bar` populates `getSecret('foo')` → `{ secret: 'bar', disabled: false, isRoot: true }`.
- [ ] `getSecret('unknown')` returns `null`.
- [ ] A DB row exists for `subkey` but `getSecret('subkey')` returns `null` and emits the `'sub-key support not enabled in v1'` warning.
- [ ] Disabled root entry (`disabled: true` in the cache) makes `getSecret` return `null`.

## Test obligations
- Unit: covered by [TEST-0212]
- E2E: N/A — pure infra
- Conformance: N/A

## Dependencies
- Blocked by: [TASK-0609], [TASK-0613]

## References
- `docs/WHITEPAPER.md` §3.10 (lines 4829–4909)
