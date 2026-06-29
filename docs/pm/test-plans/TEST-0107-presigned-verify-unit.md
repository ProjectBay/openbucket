---
id: TEST-0107
title: Presigned URL verification unit
covers: [STORY-0104, TASK-0316]
status: done
level: unit
---

## Goal
Verify `verifyPresigned` for algorithm validation, expires bounds, skew, signature mismatch, and access-key-not-found behaviour.

## Setup
- Jest. Use `@aws-sdk/s3-request-presigner` or `aws4` to produce known-good presigned URLs.

## Cases
1. Given `X-Amz-Algorithm` not `AWS4-HMAC-SHA256`, then `InvalidArgumentError('unsupported algorithm', 'X-Amz-Algorithm', val)`.
2. Given `X-Amz-Expires=0`, then `InvalidArgumentError('X-Amz-Expires out of range', 'X-Amz-Expires', '0')`.
3. Given `X-Amz-Expires=604801` (>7 days), then `InvalidArgumentError`.
4. Given `now < start - MAX_SKEW_MS`, then `RequestTimeTooSkewedError`.
5. Given `now > start + expires*1000`, then `AccessDeniedError('Request has expired')`.
6. Given unknown access key id, then `verifyPresigned` returns `false`.
7. Given mismatched signature, then `verifyPresigned` returns `false`.
8. Given valid presigned URL, then `verifyPresigned` returns `true` and `req.openbucket.accessKeyId === expected`.
9. Given a URL signed using the AWS SDK's presigner, then our verifier accepts it.

## Tooling
- Framework: jest + @aws-sdk/s3-request-presigner / aws4
- Runner: `nx test backend --testPathPattern=presigned.spec.ts`

## Pass criteria
- [ ] All nine cases pass.

## References
- `docs/WHITEPAPER.md` §2.5 (lines 1985–2131)
