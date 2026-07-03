---
id: TASK-2161
title: Add realpath/symlink re-check in SPA asset serving
story: STORY-0706
status: ready
type: implementation
size: XS
---

## Description
Remediates audit finding #16 (`CWE-59` Improper Link Resolution Before File Access /
Link Following). `safeAssetPath` (`spa-utils.ts:37`) validates that the
lexically-resolved absolute path stays within the resolved SPA root
(`abs.startsWith(rootResolved + sep)`, line 42) and then does `existsSync(abs)`, but
never calls `fs.realpathSync` to confirm the final target is not a symlink pointing
outside the SPA root. The controller then serves via
`res.sendFile(relative(spaRoot, file), { root: spaRoot })` (`spa.controller.ts:53`),
and Express 5's `send` follows symlinks without re-verifying the resolved target
against `root`. A symlink inside the SPA root whose target is outside (e.g.
`spaRoot/leak -> /etc` or `-> DATA_DIR`) would pass the lexical check and be served.
This is **not remotely exploitable** in the shipped threat model — `spaRoot` is the
read-only bundled Angular build output and no HTTP-reachable code path writes into it
(the verifier specifically cleared the backup/restore feature, which writes only
regular files into the bucket dir under Zip-Slip guards). It is added as low-cost
defense-in-depth that closes the `CWE-59` class entirely.

## Files to create / modify
- `libs/nestjs/src/lib/spa/spa-utils.ts` — modify `safeAssetPath` (lines 37–43): after
  the existing lexical containment check and `existsSync(abs)`, resolve the real path
  with `fs.realpathSync` (native) inside a try/catch and re-assert containment against
  the *real* SPA root before returning; return `null` on any throw or on escape.

## Implementation notes
- Current body (verbatim, `spa-utils.ts:40-42`):
  ```ts
  const abs = resolve(root, normalize(relative).replace(/^(\.\.[/\\])+/, ''));
  const rootResolved = resolve(root);
  if (abs !== rootResolved && !abs.startsWith(rootResolved + sep)) return null;
  return existsSync(abs) ? abs : null;
  ```
- Fix per the finding's fix note: "After the existing lexical check, resolve and
  re-verify: if (!existsSync(abs)) return null; then `real = realpathSync(abs)` inside
  try/catch (return null on throw); compare `real` against `realpathSync(rootResolved)`
  — `real === rootRealResolved || real.startsWith(rootRealResolved + sep)` — and return
  real. Resolving the root too avoids a false-negative when spaRoot itself is reached
  through a symlink."
- Import `realpathSync` from `node:fs` (the module already imports `existsSync` from
  `node:fs`). Prefer `realpathSync.native` where available.
- Alternative the finding also allows: "rely solely on `res.sendFile`'s already-used
  `root` option and drop the manual `existsSync` branch" — but the realpath re-check is
  preferred since the controller already depends on `safeAssetPath` returning a
  validated absolute path (`spa.controller.ts:43,65`).
- CWE: `CWE-59`. Severity is `INFO` / defense-in-depth — no urgency, but the fix is a
  few lines and eliminates the class.

## Acceptance criteria
- [ ] `safeAssetPath(root, rel)` returns `null` when `root/rel` resolves through a
      symlink to a real target outside the real SPA root.
- [ ] A legitimate regular file inside the SPA root still resolves and is returned
      (no regression to normal asset/`index.html` serving).
- [ ] A symlink whose target is *inside* the SPA root is still served (only escaping
      targets are rejected).
- [ ] A broken/dangling symlink (realpath throws) returns `null` rather than throwing.
- [ ] `nx test nestjs` passes, including the new [TEST-0706] symlink cases.

## Test obligations
- Unit: covered by [TEST-0706] (temp SPA root with an escaping symlink → `null`;
  in-root symlink and normal file → served; dangling symlink → `null`).
- E2E: N/A — unit coverage of `safeAssetPath` with a real temp filesystem is sufficient
  and avoids depending on a bundled SPA in the e2e image.
- Conformance: N/A.

## Dependencies
- Blocked by: none. Independent of [TASK-2160] and [TASK-2162].

## References
- White-box security audit, 2026-07-04 — finding #16 (`CWE-59`).
- `libs/nestjs/src/lib/spa/spa-utils.ts:37-43`
- `libs/nestjs/src/lib/spa/spa.controller.ts:43,53,65`
