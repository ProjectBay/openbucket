---
id: TASK-2144
title: Cap manifest.json read size in restore
story: STORY-0704
status: ready
type: implementation
size: S
---

## Description
Remediates audit finding #22 (MEDIUM, **CWE-400** Uncontrolled Resource Consumption /
**CWE-789** Memory Allocation with Excessive Size Value). `readManifest` reads the
`manifest.json` archive entry fully into an unbounded `chunks: Buffer[]` and
`Buffer.concat`s it before `JSON.parse`. Unlike object payloads (which are streamed),
the manifest entry is the one buffering exception and is **not** subject to the
`data/` name checks, so a hostile archive can ship a `manifest.json` that decompresses
to many GB, buffers into the Node heap, and OOM-crashes the whole embedding process.
This Task caps the manifest read and aborts before the buffer grows unbounded.

## Files to create / modify
- `libs/nestjs/src/lib/admin/backup/backup.service.ts` — modify `readManifest`
  (`:326`–`:354`, specifically the buffering loop at `:341`–`:345`): track cumulative
  bytes while reading the manifest stream and abort with a 400 once a configurable cap
  is exceeded, before `JSON.parse`.
- `libs/nestjs/src/lib/common/config/env.schema.ts` — modify: add
  `RESTORE_MAX_MANIFEST_BYTES` (default a few MB, e.g. `4 * 1024 * 1024`).
- `libs/nestjs/src/lib/common/config/app-config.service.ts` — modify: typed getter.

## Implementation notes
- Vulnerable loop at `backup.service.ts:341`:
  ```ts
  const chunks: Buffer[] = [];
  const rs = await openStream();
  for await (const c of rs) chunks.push(c as Buffer);
  manifest = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  ```
  There is no byte ceiling, and the manifest entry bypasses the `DATA_PREFIX` name
  checks that guard payload entries.
- Fix per the audit fix-note: maintain a running `total` and reject once it exceeds
  the cap, destroying the stream so no further bytes are read:
  ```ts
  let total = 0;
  const chunks: Buffer[] = [];
  const rs = await openStream();
  for await (const c of rs) {
    total += (c as Buffer).length;
    if (total > this.config.restoreMaxManifestBytes) {
      rs.destroy();
      throw new BadRequestException('manifest.json in backup archive is too large');
    }
    chunks.push(c as Buffer);
  }
  ```
  Keep the existing `try/catch` around `JSON.parse` that already maps invalid JSON to
  a 400 (`:346`–`:347`).
- The cap must be enforced during the read (streaming), not after concat, so the heap
  never holds the oversized buffer.

## Acceptance criteria
- [ ] A restore archive whose `manifest.json` exceeds `RESTORE_MAX_MANIFEST_BYTES` is
      rejected with HTTP 400 before the buffer is fully materialized or parsed.
- [ ] A normal (small) manifest still parses and restores successfully.
- [ ] The process memory does not spike proportionally to an oversized manifest entry
      (the stream is destroyed at the cap).
- [ ] `nx test nestjs --testPathPattern=backup` passes.

## Test obligations
- Unit: covered by [TEST-0704] (manifest read aborts at the cap, valid manifest passes)
- E2E: covered by [TEST-0704] (POST an archive with an oversized manifest → 400)
- Conformance: N/A

## Dependencies
- Blocked by: [TASK-2100], [STORY-0700]

## References
- White-box security audit, 2026-07-04 — finding #22 (CWE-400 / CWE-789).
- `libs/nestjs/src/lib/admin/backup/backup.service.ts:326-354` (`readManifest`), `:341-345` (buffering loop).
</content>
