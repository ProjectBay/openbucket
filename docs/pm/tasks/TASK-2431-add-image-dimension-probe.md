---
id: TASK-2431
title: Add an image-dimension probe over a bounded head buffer
story: STORY-0803
status: backlog
type: implementation
size: S
---

## Description
Add a helper that extracts `{ width, height, type }` from the leading bytes of an
image, so `uploadFrom` ([TASK-2433]) can return image metadata without decoding the
full image. Backed by `image-size` (pure-JS, no native build), fed only the bounded
head buffer the caller already peeks for sniffing ([TASK-2430]).

## Files to create / modify
- `libs/nestjs/src/lib/storage/image-info.ts` — new. Thin wrapper over `image-size`.
- `libs/nestjs/src/lib/storage/image-info.spec.ts` — new. Unit tests over image fixtures.
- `libs/nestjs/package.json` — modify (add `image-size` to `dependencies`).
- `package.json` — modify (workspace root: add `image-size` so the standalone app resolves it).

## Implementation notes
- Public API:
  ```ts
  export interface ImageInfo { width: number; height: number; type: string }

  /**
   * Dimensions from an image header. Returns undefined when `head` is not a
   * recognized image or is too short to carry the dimension box. Never throws.
   */
  export function imageInfo(head: Buffer): ImageInfo | undefined;
  ```
- Implement with `image-size`'s buffer form: `imageSize(head)` returns
  `{ width, height, type }`. Wrap in try/catch and return `undefined` on any throw
  (a truncated head for a format whose dimension box sits past `SNIFF_BYTES` — e.g.
  some progressive/edge cases — is a graceful miss, not an error).
- Feed it **only** the bounded head buffer (`SNIFF_BYTES` from [TASK-2430]); do not
  read the whole object. For the common web set (JPEG/PNG/GIF/WebP) the SOF/IHDR/VP8
  dimension box is within the first few hundred bytes, so 4100 bytes is ample.
- Guard `width`/`height` are finite positive numbers before returning; drop otherwise.
- Security / DoS: `image-size` is header-only parsing (no pixel decode), and we cap
  its input to the head window, so a decompression/pixel-bomb image cannot blow up
  memory here. Pin the dependency and let Dependabot (per the repo's existing CVE
  remediation flow) track it. Do **not** pull in `sharp` for this — dimensions need
  no native decode; `sharp` remains [STORY-0800]'s concern for on-the-fly transforms.

## Acceptance criteria
- [ ] `imageInfo(headOfPng)` etc. returns the exact pixel `width`/`height` for
  JPEG/PNG/GIF/WebP fixtures.
- [ ] Returns `undefined` for a non-image buffer (e.g. a PDF/zip head) without throwing.
- [ ] Returns `undefined` for a 4-byte truncated image head without throwing.
- [ ] `image-size` appears in `libs/nestjs/package.json` dependencies and the library
  builds (`nx build nestjs`).
- [ ] `nx test nestjs --testPathPattern=image-info` passes.

## Test obligations
- Unit: covered by [TEST-0803] (image-info case group).
- E2E: N/A.
- Conformance: N/A.

## Dependencies
- Blocked by: [TASK-2430] (reuses `SNIFF_BYTES` as the head window; no code dep beyond that).

## References
- `image-size` (npm) — buffer-based dimension probe.
- `libs/nestjs/src/lib/storage/content-sniff.ts` (`SNIFF_BYTES`) from [TASK-2430].
- `docs/pm/epics/EPIC-09-developer-upload-pipeline.md` — [STORY-0800] owns `sharp`;
  this task deliberately stays native-dependency-free.
