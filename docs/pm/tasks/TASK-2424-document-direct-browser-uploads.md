---
id: TASK-2424
title: Document direct browser uploads (usage and security notes)
story: STORY-0802
status: backlog
type: docs
size: XS
---

## Description
Document the presigned POST feature for both audiences: the `@openbucket/nestjs`
embedding developer (how to call `createPresignedPost` and post a browser form)
and the operator (the security model, limits, and the CORS caveat for
cross-origin browser POSTs). Add the whitepaper section the other tasks
reference so the cross-links resolve.

## Files to create / modify
- `docs/WHITEPAPER.md` — modify (add §2.6 "Browser-based uploads (PostObject / presigned POST)")
- `README.md` — modify (add a short "Direct browser uploads" subsection with the JS snippet, if the library usage lives there)
- `libs/nestjs/README.md` — modify if present (library consumer docs)

## Implementation notes
- Document the facade call and the returned shape:
  ```ts
  const { url, fields } = openBucket.createPresignedPost('avatars', {
    key: 'users/${filename}',
    keyStartsWith: true,
    contentLengthRange: { min: 1, max: 5 * 1024 * 1024 },
    contentType: { startsWith: 'image/' },
    expiresIn: 900,
    successActionStatus: '201',
  });
  // Browser: build FormData with every `fields` entry, append `file` LAST, POST to `url`.
  ```
- State the security model explicitly: the policy is signed with the **root
  credential**; a minted token authorises exactly the `key`/prefix,
  content-type, and size range in its conditions until `expiration` (max 7 days);
  the server re-enforces `content-length-range` on streamed bytes and never
  trusts client-declared length; the bucket policy (EPIC-08) still applies.
- Note the ordering rule (`file` must be the last form part) and `${filename}`
  substitution.
- **CORS caveat**: a cross-origin browser POST of `multipart/form-data` is a
  CORS "simple request" (no preflight) so the upload itself works, but reading a
  non-2xx error body or a `201` response cross-origin requires bucket CORS —
  call out that per-bucket CORS configuration is a separate concern (existing
  `PutBucketCors` surface) and recommend `success_action_redirect` for pure
  browser flows.
- Keep it concise; no new runtime behaviour.

## Acceptance criteria
- [ ] `docs/WHITEPAPER.md` contains a §2.6 that [STORY-0802]/[TASK-2420..2423] reference.
- [ ] The README snippet compiles conceptually (matches the `PresignPostOptions` shape from [TASK-2421]).
- [ ] The security model paragraph names: root-credential signing, condition scope, `expiration` cap, streamed-byte enforcement, and the CORS caveat.

## Test obligations
- Unit: N/A — pure docs
- E2E: N/A
- Conformance: N/A

## Dependencies
- Blocked by: [TASK-2421] (final option shape), [TASK-2423] (final response semantics)

## References
- `libs/nestjs/src/lib/open-bucket.service.ts` (facade doc comment style).
- `docs/WHITEPAPER.md` §2.5 (adjacent presigned-URL section).
