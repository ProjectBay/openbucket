---
id: TASK-0611
title: Implement `RefreshToken` entity
story: STORY-0203
status: done
type: implementation
size: XS
---

## Description
Implement the refresh-token entity. `id` doubles as the JTI; `tokenHash` is SHA-256 of the opaque token value; `rotatedFrom` records the previous token id when this one was minted by rotation, enabling token-reuse detection.

## Files to create / modify
- `libs/persistence/src/entities/refresh-token.entity.ts` — new

## Implementation notes
- `@Entity({ tableName: 'refresh_tokens' })`.
- `@Index({ name: 'ix_refresh_subject', properties: ['subject'] })`.
- `@Index({ name: 'ix_refresh_expires', properties: ['expiresAt'] })`.
- `@PrimaryKey({ type: 'string', length: 64 }) id!: string; // uuid v7 — also the JTI`.
- `@Property({ type: 'string', length: 128 }) tokenHash!: string; // SHA-256 of the opaque token value.`.
- `@Property({ type: 'string', length: 64 }) subject!: string;`.
- `@Property({ type: 'datetime' }) issuedAt: Date = new Date();`.
- `@Property({ type: 'datetime' }) expiresAt!: Date;`.
- `@Property({ type: 'string', length: 64, nullable: true }) rotatedFrom?: string;` — previous token id when this one was minted by rotation.

## Acceptance criteria
- [ ] Inserting a `RefreshToken` with `rotatedFrom = <previous>.id` persists the parent pointer.
- [ ] `ix_refresh_subject` and `ix_refresh_expires` are visible after migration.

## Test obligations
- Unit: covered by [TEST-0203]
- E2E: N/A
- Conformance: N/A

## Dependencies
- Blocked by: _none_

## References
- `docs/WHITEPAPER.md` §3.2.8 (lines 3416–3447)
