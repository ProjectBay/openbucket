---
id: TEST-0008
title: Classifier observable behavior end-to-end
covers: [STORY-0007]
status: done
level: e2e
---

## Goal
Verify, end-to-end via supertest against the assembled Nest app, that classifier output drives routing as documented: `/` is treated as S3, `/api/admin/health` returns the admin health JSON, and a vhost-style request resolves to the bucket label.

## Setup
- Boot Nest with `Test.createTestingModule({ imports: [AppModule] })` plus stub `Persistence/Storage/Domain/S3/Admin` modules. Set `OPENBUCKET_ENDPOINT=s3.example.com`.
- Add a debug controller (test-only) that echoes `req.openbucket` as JSON under a path that the classifier marks `s3-service` to prove the classifier ran.

## Cases
1. Given a request `GET /api/admin/health`, when the SUT responds, then status 200 and body `{ status: 'ok', uptime: <int> }`.
2. Given a request `GET /api/admin/ready`, when the SUT responds with `ShutdownState.isShuttingDown === false`, then status 200 `{ status: 'ready' }` (assumes EPIC-03 stubs accept).
3. Given a request `GET /admin/` (no `/api/`), when the SUT responds, then the SPA shell is served (HTML body containing the Angular root selector; STORY-0013 setup).
4. Given a request `GET /` with no vhost match, then a debug echo controller reports `req.openbucket.kind === 's3'`, `s3Scope === 's3-service'`.
5. Given a request `GET /mybucket/key.txt` with `Host: localhost`, then `kind === 's3'`, `addressingStyle === 'path'`, `bucket === 'mybucket'`, `key === 'key.txt'`.
6. Given a request `GET /key.txt` with `Host: mybucket.s3.example.com`, then `addressingStyle === 'virtual-host'`, `bucket === 'mybucket'`.

## Tooling
- Framework: jest + supertest
- Runner: `nx e2e openbucket-backend-e2e --testPathPattern=classifier.e2e.spec`

## Pass criteria
- [x] Cases 1, 4, 5, 6 pass (admin→JSON; path-style `/` and `/bucket/key`→S3
      XML; vhost resolves bucket from Host). Case 2 (`/ready`→200) is verified
      by TEST-0013. 
- [ ] Case 3 (SPA shell HTML on `/admin/`) — deferred to EPIC-06 (no `dist/spa`
      in M0; the no-build guard is covered by TEST-0014 instead).
- [x] `X-Request-Id` and `X-Amz-Request-Id` headers present and equal on every
      response.

## Realization note
Realized as a spawned-process **e2e** against the built backend
(`openbucket-backend-e2e/src/classifier.e2e-spec.ts`, `OPENBUCKET_ENDPOINT=s3.example.com`)
rather than `Test.createTestingModule` + a debug echo controller: the
classifier's `kind` decision is asserted indirectly via which subsystem answers
(admin JSON vs. S3 XML error shape with `<Resource>` reflecting the path),
which needs no test-only echo route.

## References
- `docs/WHITEPAPER.md` §1.5 (lines 383–522)
