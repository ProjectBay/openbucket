---
id: TEST-0007
title: Request classifier decision tree
covers: [STORY-0007, TASK-0015, TASK-0016, TASK-0017, TASK-0018]
status: done
level: unit
---

## Goal
Verify the four-branch classifier from §1.5 across the corner cases that drive routing for the rest of the system.

## Setup
- Instantiate `RequestClassifierMiddleware` with a stub `AppConfigService` whose `endpoint` is `'s3.example.com'` (for some cases) or `undefined` (for others). Construct synthetic `Request` objects and call `use(req, res, next)` directly.

## Cases
1. Given `path = '/api/admin/health'`, then `kind === 'admin'`, no bucket/key.
2. Given `path = '/api/admin'` (exact), then `kind === 'admin'`.
3. Given `path = '/admin/'`, then `kind === 'spa'`.
4. Given `path = '/admin/foo'`, then `kind === 'spa'`.
5. Given `host = 'mybucket.s3.example.com'`, `path = '/key.txt'`, endpoint set, then `kind === 's3'`, `addressingStyle === 'virtual-host'`, `bucket === 'mybucket'`, `key === 'key.txt'`, `s3Scope === 's3-object'`.
6. Given `host = 'mybucket.s3.example.com'`, `path = '/'`, endpoint set, then `kind === 's3'`, `bucket === 'mybucket'`, `key === ''`, `s3Scope === 's3-bucket'`.
7. Given `host = 'MyBucket.S3.EXAMPLE.com:9000'` (uppercase + port), endpoint set, then the case-folded match still works and the label `'mybucket'` is extracted.
8. Given `host = '_bad_.s3.example.com'` (label fails `BUCKET_LABEL`), endpoint set, then the middleware falls through to path-style.
9. Given `path = '/bucket/path/to/key'`, no vhost match, then `addressingStyle === 'path'`, `bucket === 'bucket'`, `key === 'path/to/key'`, `s3Scope === 's3-object'`.
10. Given `path = '/'`, no vhost match, then `s3Scope === 's3-service'`, no bucket/key.
11. Given `path = '/a%20b/c%2Fd'`, then `key === 'a b/c/d'` (percent-decoded).
12. Given `path = '/bucket/bad%2'`, then `key === 'bad%2'` (raw fallback, no throw).
13. Given `host = '[::1]:9000'`, then `stripPort` returns `'[::1]'`.
14. Given the classifier completes any branch, then `ctx.receivedAt` is the value of `Date.now()` at entry (within 50 ms tolerance).

## Tooling
- Framework: jest
- Runner: `nx test openbucket-backend --testPathPattern=request-classifier.middleware.spec`

## Pass criteria
- [ ] All 14 cases pass.
- [ ] No case throws.

## References
- `docs/WHITEPAPER.md` §1.5 (lines 383–490)
