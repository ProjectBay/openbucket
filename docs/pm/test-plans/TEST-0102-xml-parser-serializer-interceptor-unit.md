---
id: TEST-0102
title: XML parser/serializer/interceptor unit
covers: [STORY-0102, TASK-0308, TASK-0309, TASK-0310]
status: done
level: unit
---

## Goal
Verify `XmlParser`, `XmlSerializer`, and `XmlInterceptor` behave per §2.3 — XXE rejection, array hints, MAX_XML_BYTES, outbound POJO envelope.

## Setup
- Jest. Mocked `Request` and `Response` (via `node-mocks-http`) for the interceptor.

## Cases
1. `XmlParser`: input containing `<!DOCTYPE foo>` → `MalformedXMLError('DOCTYPE not allowed')`.
2. `XmlParser`: input `<CompleteMultipartUpload><Part><PartNumber>1</PartNumber><ETag>e</ETag></Part></CompleteMultipartUpload>` → `Part` is an array even with one element.
3. `XmlParser`: each of `Object`, `Rule`, `CORSRule`, `AllowedOrigin`, `AllowedMethod`, `AllowedHeader`, `ExposeHeader`, `Tag`, `Grant`, `NoncurrentVersionTransition`, `Transition` parses as an array when there is exactly one.
4. `XmlSerializer`: serializes `{ Foo: 'bar' }` with root `Result` → `<?xml version="1.0" encoding="UTF-8"?><Result xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Foo>bar</Foo></Result>`.
5. `XmlSerializer`: input contains `__root` / `__raw` keys → output strips them.
6. `XmlInterceptor`: PUT request with `req.openbucket.operation = 'PutBucketTagging'` and a 100 KB body → parses, attaches `(req as any).xmlBody`.
7. `XmlInterceptor`: PUT request with body > `MAX_XML_BYTES = 256 * 1024` → rejects with `MalformedXMLError('XML body too large')`.
8. `XmlInterceptor`: handler returns `Buffer.from('binary')` → passes through unchanged, no XML envelope.
9. `XmlInterceptor`: handler returns `{ __raw: true, body: '…' }` → passes through.
10. `XmlInterceptor`: handler returns `{ __root: 'ListBucketResult', Name: 'b' }` → response sets `Content-Type: application/xml` and `Content-Length` matches `Buffer.byteLength(body, 'utf8')`.

## Tooling
- Framework: jest
- Runner: `nx test backend --testPathPattern=xml`

## Pass criteria
- [ ] All ten cases pass.

## References
- `docs/WHITEPAPER.md` §2.3 (lines 1326–1574)
