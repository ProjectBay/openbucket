---
id: TEST-0101
title: RouteResolver unit
covers: [STORY-0101, TASK-0307]
status: done
level: unit
---

## Goal
Verify `RouteResolver.resolve` validates `req.openbucket.kind === 's3'`, validates the bucket against `BUCKET_NAME_RE`, rejects `..`, and returns identical `(bucket, key)` results under both addressing styles.

## Setup
- Jest. Build fake `Request` objects with `req.openbucket = { kind, style, bucket, keyRaw, requestId, receivedAt }`.

## Cases
1. Given `kind='admin'`, then `resolve` throws `InvalidBucketNameError('')`.
2. Given `kind='s3', bucket=null`, then `InvalidBucketNameError('')`.
3. Given `bucket='Invalid_Bucket'`, then `InvalidBucketNameError('Invalid_Bucket')` (uppercase + underscore both fail `BUCKET_NAME_RE`).
4. Given `bucket='ab'`, then `InvalidBucketNameError` (too short — regex demands 3+ chars).
5. Given `bucket='ok'+`a`.repeat(60)+`z'` (length 63), then resolves cleanly.
6. Given `bucket='good..bad'`, then `InvalidBucketNameError` (contains `..`).
7. Given path-style req `bucket='photos', keyRaw='2026/sunset.jpg'` and virtual-host-style req with the same values, then both return `{ bucket: 'photos', key: '2026/sunset.jpg' }`.
8. Given `bucket='ok', keyRaw=null`, then returns `{ bucket: 'ok', key: '' }`.

## Tooling
- Framework: jest
- Runner: `nx test backend --testPathPattern=route-resolver.spec.ts`

## Pass criteria
- [x] All 8 cases pass (`apps/openbucket-backend/src/s3/routing/route-resolver.spec.ts`); backend suite 187/187.

## References
- `docs/WHITEPAPER.md` §2.2 (lines 1243–1323)
