---
id: TASK-0919
title: Validate parts list (non-empty, sort, contiguous from 1, declared ETag match)
story: STORY-0307
status: done
type: implementation
size: S
---

## Description
Create the `CompleteMultipartHandler` and implement parts-list validation: empty → `MalformedXML`; sort by `partNumber`; require contiguous from 1; cross-check each declared part against `multipart.listParts(...)` and reject mismatched declared/recorded ETags.

## Files to create / modify
- `apps/backend/src/s3/multipart/complete-multipart.handler.ts` — new

## Implementation notes
- Verbatim per §4.4.3:
  ```ts
  if (body.parts.length === 0) {
    throw new S3Error('MalformedXML', 'CompleteMultipartUpload requires at least one part');
  }

  const sorted = [...body.parts].sort((a, b) => a.partNumber - b.partNumber);
  for (let i = 0; i < sorted.length; i++) {
    if (sorted[i].partNumber !== i + 1) {
      throw new S3Error(
        'InvalidPartOrder',
        `Parts must be contiguous from 1; got ${sorted[i].partNumber} at position ${i + 1}`,
      );
    }
  }

  const recorded = await this.multipart.listParts({ uploadId });
  const recordedByNumber = new Map(recorded.map((p) => [p.partNumber, p]));
  ```
- Declared ETag may have surrounding quotes — strip with `.replace(/^"|"$/g, '')` before comparison.

## Acceptance criteria
- [ ] Empty parts list → `S3Error('MalformedXML', ...)`.
- [ ] Non-contiguous list → `S3Error('InvalidPartOrder', ...)`.
- [ ] Missing recorded part → `S3Error('InvalidPart', 'Part N was not uploaded')`.
- [ ] Mismatched ETag → `S3Error('InvalidPart', 'Part N ETag mismatch')`.

## Test obligations
- Unit: covered by [TEST-0312]
- E2E: covered by [TEST-0309]
- Conformance: covered by [TEST-0310]

## Dependencies
- Blocked by: [TASK-0918]

## References
- `docs/WHITEPAPER.md` §4.4.3 (lines 5887–5942)
