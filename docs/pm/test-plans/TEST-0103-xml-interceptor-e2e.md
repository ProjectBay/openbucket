---
id: TEST-0103
title: XML interceptor e2e
covers: [STORY-0102, TASK-0310]
status: backlog
level: e2e
---

## Goal
Verify the `XmlInterceptor` works end-to-end against the running Nest app — XML round-trip through a `PutBucketTagging`-style endpoint, with the correct response envelope.

## Setup
- Bootstrap the backend via `Test.createTestingModule(AppModule)` and supertest.
- Provision a root access key via a test fixture so SigV4Guard accepts the request.
- Sign requests with `aws4.sign`.

## Cases
1. Given a `PUT /b?tagging` with a valid `<Tagging>` body, when sent, then 200 and the persisted document round-trips via `GET /b?tagging` (XML namespace `http://s3.amazonaws.com/doc/2006-03-01/`).
2. Given a `PUT /b?tagging` with malformed XML, when sent, then 400 `<Code>MalformedXML</Code>`.
3. Given a `PUT /b?tagging` with body > 256 KB, when sent, then 400 `<Code>MalformedXML</Code>` with the size-too-large message.

## Tooling
- Framework: jest + supertest + aws4
- Runner: `nx e2e backend-e2e --testPathPattern=xml-interceptor`

## Pass criteria
- [ ] All three cases pass; response bodies include the canonical XML declaration and namespace.

## References
- `docs/WHITEPAPER.md` §2.3 (lines 1326–1574)
