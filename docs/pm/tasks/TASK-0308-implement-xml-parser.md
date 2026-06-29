---
id: TASK-0308
title: Implement XmlParser
story: STORY-0102
status: done
type: implementation
size: S
---

## Description
Implement `XmlParser` using `fast-xml-parser@4.4.x` with the XXE-hardened option set and the array hints S3 documents need.

## Files to create / modify
- `apps/backend/src/s3/xml/xml.parser.ts` — new

## Implementation notes
- Verbatim option set from §2.3.3 (lines 1467–1498):
  ```ts
  private readonly parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    parseAttributeValue: true,
    parseTagValue: true,
    trimValues: true,
    processEntities: false,        // XXE defence: no entity processing.
    htmlEntities: false,
    allowBooleanAttributes: false,
    // Hint arrays for elements that S3 documents repeat:
    isArray: (name) =>
      [
        'Part',
        'Object',
        'Rule',
        'CORSRule',
        'AllowedOrigin',
        'AllowedMethod',
        'AllowedHeader',
        'ExposeHeader',
        'Tag',
        'Grant',
        'NoncurrentVersionTransition',
        'Transition',
      ].includes(name),
  });
  ```
- `parse(xml: string): unknown` pre-checks `/<!DOCTYPE/i.test(xml)` and throws `MalformedXMLError('DOCTYPE not allowed')`; an empty parse result throws `MalformedXMLError('expected root element')`.

## Acceptance criteria
- [ ] `parse('<!DOCTYPE foo>…')` throws `MalformedXMLError`.
- [ ] Parsing a `<CompleteMultipartUpload>` body produces `Part` as an array even with one element.
- [ ] `nx test backend --testPathPattern=xml.parser.spec.ts` passes.

## Test obligations
- Unit: covered by [TEST-0102]
- E2E: covered by [TEST-0103]
- Conformance: N/A

## Dependencies
- Blocked by: [STORY-0105]

## References
- `docs/WHITEPAPER.md` §2.3.3 (lines 1463–1512)
