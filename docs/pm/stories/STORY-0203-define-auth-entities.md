---
id: STORY-0203
title: Define auth and admin entities (AccessKey, AdminUser, RefreshToken)
epic: EPIC-03
status: done
size: S
risk: low
---

## User story
As a developer, I want the three auth-side MikroORM entities (`AccessKey`, `AdminUser`, `RefreshToken`) declared so that the admin module ([EPIC-05]), the SigV4 path ([EPIC-02]), and `KeyService.getSecret` ([STORY-0212]) have stable storage for credential material and refresh-token state.

## Description
Implement the three auth-related entities exactly as specified in §3.2.6–§3.2.8. `AccessKey` stores an argon2id `secretHash` plus a `disabled` flag; the plaintext path for SigV4 is held in memory by `KeyService`. `AdminUser` is a single-row entity with an argon2id `passwordHash`. `RefreshToken` carries the JTI, SHA-256 `tokenHash`, subject, issued/expires timestamps, and `rotatedFrom` for chain detection. Entities live under `libs/persistence/src/entities/` and will be re-exported from the barrel in [STORY-0204].

## Acceptance criteria
- [x] `AccessKey` PK is `accessKeyId` (length 32), with `secretHash` (length 256), `label` (length 128, default ''), `disabled` (boolean default false), and `createdAt`.
- [x] `AdminUser` PK is `username` (length 64) with `passwordHash` (length 256) and `createdAt`.
- [x] `RefreshToken` PK is `id` (length 64, uuid v7 / JTI), `tokenHash` (length 128, SHA-256 hex), `subject`, `issuedAt`, `expiresAt`, optional `rotatedFrom`, with indexes `ix_refresh_subject` and `ix_refresh_expires`.
- [x] Unit tests insert and read back each entity, including a token rotated from another (TEST-0203).

## Tasks
- [TASK-0609] Implement `AccessKey` entity
- [TASK-0610] Implement `AdminUser` entity
- [TASK-0611] Implement `RefreshToken` entity

## Test plan
- [TEST-0203] Auth entity persistence round-trip

## Dependencies
- Blocks: [STORY-0204], [STORY-0205], [STORY-0212]
- Blocked by: [STORY-0201]

## References
- `docs/WHITEPAPER.md` §3.2.6 (lines 3366–3393), §3.2.7 (lines 3395–3414), §3.2.8 (lines 3416–3447)
- Interfaces produced: `AccessKey`, `AdminUser`, `RefreshToken`
