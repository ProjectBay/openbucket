---
id: TASK-0610
title: Implement `AdminUser` entity
story: STORY-0203
status: done
type: implementation
size: XS
---

## Description
Implement the single-admin entity. `passwordHash` is the argon2id hash verified by `argon2.verify()` in the admin login path ([EPIC-05]).

## Files to create / modify
- `libs/persistence/src/entities/admin-user.entity.ts` — new

## Implementation notes
- `@Entity({ tableName: 'admin_users' })`.
- `@PrimaryKey({ type: 'string', length: 64 }) username!: string;`.
- `@Property({ type: 'string', length: 256 }) passwordHash!: string; // argon2id hash. Verified with argon2.verify().`.
- `@Property({ type: 'datetime' }) createdAt: Date = new Date();`.

## Acceptance criteria
- [ ] Entity persists with the three columns and `username` as PK.
- [ ] No plaintext password column exists.

## Test obligations
- Unit: covered by [TEST-0203]
- E2E: N/A
- Conformance: N/A

## Dependencies
- Blocked by: _none_

## References
- `docs/WHITEPAPER.md` §3.2.7 (lines 3395–3414)
