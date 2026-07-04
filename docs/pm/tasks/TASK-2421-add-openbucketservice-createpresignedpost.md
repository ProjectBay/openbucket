---
id: TASK-2421
title: Add OpenBucketService.createPresignedPost facade and option types
story: STORY-0802
status: backlog
type: implementation
size: S
---

## Description
Expose the minting half of presigned POST on the host-app-facing facade,
alongside the existing `presignGetUrl` / `presignPutUrl`. It wraps
`buildPresignedPost` ([TASK-2420]) over the root credential and the resolved
public origin + `mountPath`, so an embedding app can hand `{ url, fields }` to a
browser form. Pure crypto — no DB/filesystem access, consistent with the other
presign methods.

## Files to create / modify
- `libs/nestjs/src/lib/open-bucket.service.ts` — modify (add `createPresignedPost` + `PresignPostOptions`/`PresignedPost` types)
- `libs/nestjs/src/lib/open-bucket.service.spec.ts` — modify (or new) — unit test the facade
- `libs/nestjs/src/index.ts` — modify (re-export new public types if the barrel lists them)

## Implementation notes
- Signatures:
  ```ts
  interface PresignPostOptions {
    /** Object key. May contain the literal `${filename}` placeholder. */
    key: string;
    /** Lifetime in seconds (1 … 7 days). Default 900. */
    expiresIn?: number;
    /** Public origin (scheme + host); defaults to `endpoint` like the other presign methods. */
    baseUrl?: string;
    /** Restrict the accepted byte size of the uploaded file. */
    contentLengthRange?: { min: number; max: number };
    /** Pin or prefix-restrict the content type (`['starts-with','$Content-Type','image/']`). */
    contentType?: string | { startsWith: string };
    /** `starts-with` the key instead of an exact match (folder-scoped upload tokens). */
    keyStartsWith?: boolean;
    /** Extra raw conditions passed straight through (escape hatch). */
    conditions?: PostPolicyCondition[];
    successActionStatus?: '200' | '201' | '204';
    successActionRedirect?: string;
  }
  interface PresignedPost { url: string; fields: Record<string, string>; }
  createPresignedPost(bucket: string, opts: PresignPostOptions): PresignedPost;
  ```
- Reuse the existing private `resolveOrigin(opts.baseUrl)` and `mountPath` getter already used by `presign(...)`; pass `basePath: this.mountPath`, `scheme`, `host`, `region: this.config.region`, `accessKeyId: this.config.rootAccessKeyId`, `secretAccessKey: this.config.rootSecretAccessKey`, `now: new Date()`, and `expiresIn` clamped with the existing `Math.min(Math.max(opts.expiresIn ?? 900, 1), MAX_EXPIRES)` idiom.
- Default a `content-length-range` of `{ min: 0, max: this.config.maxObjectSizeMb * 1024 * 1024 }` when the caller omits `contentLengthRange`, so a minted token can never authorise an object larger than the server cap (defence in depth; [TASK-2422] re-enforces on the wire).
- Map `contentType`/`contentLengthRange`/`keyStartsWith`/`success_*` into `extraConditions` for `buildPresignedPost`.
- Keep the method synchronous (no `withContext`) — it touches neither the DB nor FS, matching the doc comment "Presign methods are pure crypto over the root credentials."
- Edge cases: throw the same clear error as `resolveOrigin` when neither `baseUrl` nor `endpoint` is set; reject a `contentLengthRange` with `min > max` or negatives before minting.

## Acceptance criteria
- [ ] `createPresignedPost('b', { key: 'u/${filename}', contentLengthRange: { min: 1, max: 10485760 } })` returns `{ url, fields }` with `url` ending `/b` (or `${mountPath}/b`) and all six required fields present.
- [ ] The returned `fields.policy` base64-decodes to a JSON policy whose `conditions` include `{ bucket: 'b' }`, the `$key` condition, and `['content-length-range', 1, 10485760]`.
- [ ] `nx test nestjs --testPathPattern=open-bucket.service` passes.
- [ ] `nx build nestjs` typechecks with the new exported types.

## Test obligations
- Unit: covered by [TEST-0802]
- E2E: covered by [TEST-0802] (the minted token is consumed by the wire test)
- Conformance: N/A

## Dependencies
- Blocked by: [TASK-2420]

## References
- `libs/nestjs/src/lib/open-bucket.service.ts` (`presign`, `resolveOrigin`, `PresignOptions`, `mountPath`).
- `libs/nestjs/src/lib/common/config/app-config.service.ts` (`rootAccessKeyId`, `region`, `maxObjectSizeMb`, `endpoint`).
