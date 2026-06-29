---
id: TEST-0129
title: Encryption e2e
covers: [STORY-0116, TASK-0358]
status: done
level: e2e
---

## Goal
End-to-end verify bucket encryption configuration round-trip.

## Setup
- Boot backend, sign with aws4.

## Cases
1. `PUT /b?encryption` with `<ServerSideEncryptionConfiguration><Rule><ApplyServerSideEncryptionByDefault><SSEAlgorithm>AES256</SSEAlgorithm></ApplyServerSideEncryptionByDefault></Rule></ServerSideEncryptionConfiguration>` → 200.
2. `GET /b?encryption` returns the persisted document.
3. `DELETE /b?encryption` → 204; `GET /b?encryption` → 404 (per `BucketService.getEncryption` contract).
4. `PUT /b?encryption` with `SSEAlgorithm: aws:kms` → 400 `<Code>InvalidArgument</Code>`.

## Tooling
- Framework: jest + supertest + aws4
- Runner: `nx e2e backend-e2e --testPathPattern=encryption`

## Pass criteria
- [ ] All four cases pass.

## References
- `docs/WHITEPAPER.md` §2.8.2 (lines 2529–2531)
