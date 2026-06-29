---
id: TASK-0917
title: Implement O_EXCL-safe tmp path with randomUUID suffix and pipeline write
story: STORY-0306
status: done
type: implementation
size: S
---

## Description
Stream the verified part body to disk using `pipeline(ctx.stream, writable)`. The writable opens with `flags: 'wx'` (O_EXCL); a `randomUUID()` suffix on the tmp path prevents concurrent same-`partNumber` writes from colliding. On pipeline error, best-effort `unlink(tmpPath)`. On success, `rename(tmpPath, finalPath)` for last-rename-wins atomic publish.

## Files to create / modify
- `apps/backend/src/s3/multipart/upload-part.handler.ts` — modify

## Implementation notes
- Verbatim collision-tolerant tmp pattern per §4.8:
  ```ts
  const tmpPath = join(
    partDir,
    `${partNumber}.part.${randomUUID()}.tmp`,
  );
  ```
- Verbatim writable configuration per §4.4.2:
  ```ts
  const writable = createWriteStream(tmpPath, {
    flags: 'wx',           // O_WRONLY|O_CREAT|O_EXCL — fail if exists
    highWaterMark: 256 * 1024,
    mode: 0o600,
  });
  ```
- Verbatim flow per §4.4.2:
  ```ts
  try {
    await pipeline(ctx.stream, writable);
  } catch (err) {
    await unlink(tmpPath).catch(() => undefined);
    throw err;
  }
  await rename(tmpPath, finalPath);
  ```
- `partDir = join(this.config.dataDir, 'multipart', uploadId)`.
- `finalPath = join(partDir, \`${partNumber}.part\`)`.

## Acceptance criteria
- [ ] Tmp path uses `randomUUID()` suffix.
- [ ] Writable has `flags: 'wx'`, `highWaterMark: 256 * 1024`, `mode: 0o600`.
- [ ] Pipeline error path runs `unlink(tmpPath)` swallowing its own error.
- [ ] On success, `rename(tmpPath, finalPath)` runs before service record.

## Test obligations
- Unit: covered by [TEST-0311]
- E2E: covered by [TEST-0309]
- Conformance: covered by [TEST-0310]

## Dependencies
- Blocked by: [TASK-0916]

## References
- `docs/WHITEPAPER.md` §4.4.2 (lines 5827–5848), §4.8 (lines 6193–6199)
