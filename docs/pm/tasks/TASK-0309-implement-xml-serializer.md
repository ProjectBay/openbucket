---
id: TASK-0309
title: Implement XmlSerializer
story: STORY-0102
status: done
type: implementation
size: S
---

## Description
Implement `XmlSerializer` using `XMLBuilder` from `fast-xml-parser`. Emits the canonical S3 envelope with `xmlns="http://s3.amazonaws.com/doc/2006-03-01/"`, strips internal hints, and is consumed by the `XmlInterceptor` (TASK-0310) and the exception filter (TASK-0321).

## Files to create / modify
- `apps/backend/src/s3/xml/xml.serializer.ts` — new

## Implementation notes
- Verbatim from §2.3.4 (lines 1516–1560):
  ```ts
  const XML_NS = 'http://s3.amazonaws.com/doc/2006-03-01/';

  @Injectable()
  export class XmlSerializer {
    private readonly builder = new XMLBuilder({
      attributeNamePrefix: '@_',
      ignoreAttributes: false,
      format: false,                    // S3 wire format isn't pretty-printed.
      suppressEmptyNode: false,
      processEntities: true,
      suppressBooleanAttributes: false,
    });

    serialize(rootName: string, value: unknown): string { /* ... */ }
    private stripInternals(v: unknown): unknown { /* strips __root, __raw */ }
  }
  ```
- Serialize: wrap value as `{ '?xml': { '@_version': '1.0', '@_encoding': 'UTF-8' }, [rootName]: { '@_xmlns': XML_NS, ...cleaned } }`.

## Acceptance criteria
- [ ] Output starts with `<?xml version="1.0" encoding="UTF-8"?>`.
- [ ] Root element carries `xmlns="http://s3.amazonaws.com/doc/2006-03-01/"`.
- [ ] `__root` and `__raw` keys never appear in the output.

## Test obligations
- Unit: covered by [TEST-0102]
- E2E: covered by [TEST-0103]
- Conformance: N/A

## Dependencies
- Blocked by: [TASK-0300]

## References
- `docs/WHITEPAPER.md` §2.3.4 (lines 1514–1560)
