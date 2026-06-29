---
id: STORY-0102
title: XML request/response handling
epic: EPIC-02
status: done
size: M
risk: medium
---

## User story
As an S3 client, I want the server to parse the XML request bodies S3 defines and to serialize POJO handler returns into the S3 XML envelope, so that aws-cli/mc/s3cmd can exchange XML on the operations that require it.

## Description
Realize §2.3 of the white paper. Build `XmlParser` (fast-xml-parser@4.4.x, XXE-hardened, with array hints for `Part`, `Object`, `Rule`, `CORSRule`, `AllowedOrigin`, `AllowedMethod`, `AllowedHeader`, `ExposeHeader`, `Tag`, `Grant`, `NoncurrentVersionTransition`, `Transition`), `XmlSerializer` (XMLBuilder with `xmlns="http://s3.amazonaws.com/doc/2006-03-01/"`), and `XmlInterceptor` that buffers up to 256 KB of inbound XML for the operations in `XML_REQUEST_OPS` and serializes any POJO with `__root` field on the way out. Buffer streams: pass through.

## Acceptance criteria
- [ ] `XmlParser` rejects any document containing `<!DOCTYPE` with `MalformedXMLError`.
- [ ] `XmlSerializer.serialize(rootName, value)` produces `<?xml version="1.0" encoding="UTF-8"?>` plus `<rootName xmlns="http://s3.amazonaws.com/doc/2006-03-01/">…</rootName>` and strips `__root`/`__raw` internals.
- [ ] `XmlInterceptor` triggers inbound parsing only when `req.openbucket.operation` is in `XML_REQUEST_OPS` and `method !== 'GET' && method !== 'HEAD'`.
- [ ] Inbound body bigger than `MAX_XML_BYTES = 256 * 1024` is rejected with `MalformedXMLError`.
- [ ] Outbound `Buffer` and `{ __raw: true }` envelopes pass through unchanged.

## Tasks
- [TASK-0308] Implement XmlParser
- [TASK-0309] Implement XmlSerializer
- [TASK-0310] Implement XmlInterceptor

## Test plan
- [TEST-0102] XML parser/serializer/interceptor unit
- [TEST-0103] XML interceptor e2e

## Dependencies
- Blocks: [STORY-0100], [STORY-0108], [STORY-0109], [STORY-0110]
- Blocked by: [STORY-0105]

## References
- `docs/WHITEPAPER.md` §2.3 (lines 1326–1574)
- Interfaces consumed: `MalformedXMLError` (defined in STORY-0105), `req.openbucket.operation` (defined in STORY-0100)
- Interfaces produced: `XmlParser`, `XmlSerializer`, `XmlInterceptor`, `XML_REQUEST_OPS`, `MAX_XML_BYTES`
