---
id: TASK-0626
title: Implement `atomicRename` with `EXDEV` copy+unlink fallback
story: STORY-0208
status: done
type: implementation
size: S
---

## Description
Implement the internal `atomicRename(src, dst)` helper used by every write/delete path. Tries `fs.rename` (atomic across the same filesystem), and on `EXDEV` falls back to `fs.copyFile` + `unlink` with a loud warning so the operator notices the misconfiguration.

## Files to create / modify
- `apps/openbucket-backend/src/storage/blob-store.ts` — modify (add private helper)

## Implementation notes
- Signature: `private async atomicRename(src: string, dst: string): Promise<void>`.
- Body (verbatim from §3.6.2):
  ```ts
  try {
    await fs.rename(src, dst);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EXDEV') throw err;
    this.log.warn(
      `EXDEV: ${src} -> ${dst} is cross-device. Falling back to copy+unlink. ` +
        'Check that DATA_DIR/tmp and DATA_DIR/blobs share a mount.',
    );
    await fs.copyFile(src, dst);
    await this.unlinkQuiet(src);
  }
  ```
- This helper is the contract for both `putBlob` and `deleteBlob` — any rename-like operation in the storage layer routes through it.
- Per §3.6.2 comment: `rename(2)` is atomic only on the same filesystem; `EXDEV` is the explicit signal that `tmp/` and the destination live on different mounts (operator misconfig or containerised volumes). The copy+unlink fallback is **not** atomic but is correct under the constraint.

## Acceptance criteria
- [ ] On the happy path, `atomicRename(src, dst)` calls `fs.rename` once and returns.
- [ ] When `fs.rename` is mocked to throw an `EXDEV`-coded error once, the fallback runs: `dst` exists with the same bytes as `src`, `src` is gone, and `log.warn` was called with the substring `'EXDEV:'`.
- [ ] Any other thrown error (`EACCES`, `EPERM`) is rethrown without fallback.

## Test obligations
- Unit: covered by [TEST-0208]
- E2E: N/A
- Conformance: N/A

## Dependencies
- Blocked by: [TASK-0620]

## References
- `docs/WHITEPAPER.md` §3.6.2 (lines 4446–4465)
