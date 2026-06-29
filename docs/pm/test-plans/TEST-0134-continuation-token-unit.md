---
id: TEST-0134
title: ContinuationToken unit
covers: [STORY-0118, TASK-0362]
status: done
level: unit
---

## Goal
Verify `ContinuationToken.encode`/`decode` round-trip and reject every tampering variant per §2.10.

## Setup
- Jest. Instantiate `ContinuationToken` and trigger `onModuleInit` to set the secret.

## Cases
1. `encode({ v: 1, b: 'bucket', afterKey: 'k', delimiter: null, prefix: '' })` then `decode(token, 'bucket')` returns the same object.
2. Decode with `expectedBucket = 'other'` throws `InvalidArgumentError('continuation token does not belong to this listing', 'continuation-token', token)`.
3. Tampering with the payload (replace one byte after base64url-decoding then re-encoding) → `InvalidArgumentError('continuation token failed validation', 'continuation-token', token)`.
4. Tampering with the MAC (last 12 bytes) → same error as above.
5. Garbage input (`'!!!'`) → `InvalidArgumentError('invalid continuation token', 'continuation-token', token)`.
6. Decoding a token whose payload JSON has `v: 2` → `InvalidArgumentError('continuation token does not belong to this listing', …)`.
7. Two `ContinuationToken` instances (different secrets) cannot decode each other's tokens.

## Tooling
- Framework: jest
- Runner: `nx test backend --testPathPattern=continuation-token`

## Pass criteria
- [ ] All seven cases pass.

## References
- `docs/WHITEPAPER.md` §2.10 (lines 2689–2766)
