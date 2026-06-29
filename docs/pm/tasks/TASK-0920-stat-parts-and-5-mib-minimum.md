---
id: TASK-0920
title: Stat each part file and enforce 5 MiB minimum (last-part exempt)
story: STORY-0307
status: done
type: implementation
size: XS
---

## Description
Inside the validation loop, build `path = join(this.config.dataDir, 'multipart', uploadId, '${declared.partNumber}.part')`, `stat(path)`, raise `InvalidPart` if missing, and raise `EntityTooSmall` if any part except the last is smaller than `5 * 1024 * 1024` bytes.

## Files to create / modify
- `apps/backend/src/s3/multipart/complete-multipart.handler.ts` — modify

## Implementation notes
- Verbatim loop body per §4.4.3:
  ```ts
  const path = join(this.config.dataDir, 'multipart', uploadId, `${declared.partNumber}.part`);
  const st = await stat(path).catch(() => null);
  if (!st) throw new S3Error('InvalidPart', `Part file missing: ${path}`);

  const isLast = i === sorted.length - 1;
  if (!isLast && st.size < 5 * 1024 * 1024) {
    throw new S3Error(
      'EntityTooSmall',
      `Part ${declared.partNumber} is smaller than 5 MiB`,
    );
  }

  partPaths.push(path);
  ```
- `5 * 1024 * 1024` is the AWS-spec minimum; verbatim, not paraphrased.

## Acceptance criteria
- [ ] Missing part file raises `S3Error('InvalidPart', 'Part file missing: <path>')`.
- [ ] Any part except the last with `size < 5 * 1024 * 1024` raises `S3Error('EntityTooSmall', 'Part N is smaller than 5 MiB')`.
- [ ] `partPaths` is built in ascending part order.

## Test obligations
- Unit: covered by [TEST-0312]
- E2E: covered by [TEST-0309]
- Conformance: covered by [TEST-0310]

## Dependencies
- Blocked by: [TASK-0919]

## References
- `docs/WHITEPAPER.md` §4.4.3 (lines 5942–5955)
