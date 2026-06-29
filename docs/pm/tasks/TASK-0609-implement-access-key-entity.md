---
id: TASK-0609
title: Implement `AccessKey` entity
story: STORY-0203
status: done
type: implementation
size: XS
---

## Description
Implement the `AccessKey` entity. Stores the argon2id hash of the secret, *never* the plaintext. The plaintext-bearing SigV4 path in v1 lives in memory via `KeyService` ([STORY-0212]) seeded from env; this entity is shaped for the future sub-key story.

## Files to create / modify
- `libs/persistence/src/entities/access-key.entity.ts` — new

## Implementation notes
- `@Entity({ tableName: 'access_keys' })`.
- `@PrimaryKey({ type: 'string', length: 32 }) accessKeyId!: string;`.
- `@Property({ type: 'string', length: 256 }) secretHash!: string; // argon2id hash of the secret. Never store the plaintext.`.
- `@Property({ type: 'string', length: 128, default: '' }) label: string = '';`.
- `@Property({ type: 'datetime' }) createdAt: Date = new Date();`.
- `@Property({ type: 'boolean', default: false }) disabled: boolean = false;`.
- See §3.2.6 note: SigV4 requires plaintext recovery → not possible from `secretHash`. v1 sources root pair from env; future sub-keys will need an envelope-encryption scheme (out of scope).

## Acceptance criteria
- [ ] Entity persists with default `label = ''` and `disabled = false`.
- [ ] No plaintext secret column exists.

## Test obligations
- Unit: covered by [TEST-0203]
- E2E: N/A
- Conformance: N/A

## Dependencies
- Blocked by: _none_ (within STORY-0203)

## References
- `docs/WHITEPAPER.md` §3.2.6 (lines 3366–3393)
