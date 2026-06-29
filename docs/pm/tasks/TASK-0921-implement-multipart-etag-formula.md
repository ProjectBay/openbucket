---
id: TASK-0921
title: Implement multipart ETag formula `md5(concat(md5(part_i)))-N`
story: STORY-0307
status: done
type: implementation
size: XS
---

## Description
Compute the final multipart ETag as `md5(concat(md5(part1), md5(part2), ...))-N`. The per-part MD5 hexes come from the declared parts list (already cross-checked against the recorded ETags).

## Files to create / modify
- `apps/backend/src/s3/multipart/complete-multipart.handler.ts` — modify

## Implementation notes
- Verbatim per §4.4.3:
  ```ts
  // Multipart ETag = md5(concat(md5(part1), md5(part2), ...)) + "-N"
  const partsMd5Buf = Buffer.concat(
    sorted.map((p) => Buffer.from(p.etag.replace(/^"|"$/g, ''), 'hex')),
  );
  const compositeMd5 = createHash('md5').update(partsMd5Buf).digest('hex');
  const finalEtag = `${compositeMd5}-${sorted.length}`;
  ```
- Strip surrounding quotes from each declared ETag before hex-decoding.
- N is `sorted.length`.

## Acceptance criteria
- [ ] `finalEtag` matches `${md5(concat(md5_bytes_per_part))}-${N}` with lowercase hex and a single dash.
- [ ] Quotes around incoming ETags are stripped before `Buffer.from(..., 'hex')`.

## Test obligations
- Unit: covered by [TEST-0312]
- E2E: covered by [TEST-0309]
- Conformance: covered by [TEST-0310]

## Dependencies
- Blocked by: [TASK-0920]

## References
- `docs/WHITEPAPER.md` §4.4.3 (lines 5960–5965)
