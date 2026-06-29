---
id: TEST-0111
title: Service ops e2e (ListBuckets)
covers: [STORY-0107, TASK-0322]
status: done
level: e2e
---

## Goal
End-to-end verify `GET /` returns `<ListAllMyBucketsResult>` for the root credentials.

## Setup
- Boot the backend, create three buckets via direct service calls, sign requests with aws4.

## Cases
1. Given three buckets `a`, `b`, `c`, when `GET /`, then 200 and `<Buckets><Bucket><Name>a</Name>…</Bucket>…</Buckets>` contains all three with `<CreationDate>`.
2. Given zero buckets, when `GET /`, then `<Buckets/>` is empty but `<Owner>` is present.
3. Given a wrongly-signed request, when sent, then 403 `<Code>SignatureDoesNotMatch</Code>`.

## Tooling
- Framework: jest + supertest + aws4
- Runner: `nx e2e backend-e2e --testPathPattern=service-ops`

## Pass criteria
- [ ] All three cases pass.

## References
- `docs/WHITEPAPER.md` §2.8.1 (lines 2495–2499)
