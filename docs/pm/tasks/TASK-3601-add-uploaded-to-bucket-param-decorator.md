---
id: TASK-3601
title: Add the @UploadedToBucket() NestJS param decorator
story: STORY-1200
status: backlog
type: implementation
size: S
---

## Description
Add a NestJS param decorator, `@UploadedToBucket()`, that reads the OpenBucket
result the storage engine (TASK-3600) merged onto the multer file object and hands
the handler a clean `{ bucket, key, url, etag, size, contentType }` — so a
controller never has to reach into `file.openBucket` by hand. It supports the
single-file (`req.file`), array, and fields (`req.files`) shapes.

## Files to create / modify
- `libs/nestjs/src/lib/adapters/multer/uploaded-to-bucket.decorator.ts` — new
- `libs/nestjs/src/lib/adapters/multer/index.ts` — modify (re-export the decorator + `UploadedFileInfo`)

## Implementation notes
- Built with `createParamDecorator` (`@nestjs/common`), reading the Express request
  from `ctx.switchToHttp().getRequest()`.
- **Result shape** (from the `openBucket` payload the engine attaches in TASK-3600):
  ```ts
  export interface UploadedFileInfo {
    bucket: string;
    key: string;
    url?: string;           // present iff an origin was resolvable / presign given
    etag: string;
    size: number;
    contentType: string;    // the RESOLVED (sniffed) type
    versionId?: string;
    image?: ImageInfo;      // present when the body probed as an image
  }
  export const UploadedToBucket: (field?: string) =>
    ParameterDecorator; // returns UploadedFileInfo | UploadedFileInfo[] | undefined
  ```
- **Resolution order** (mirrors Nest's own `@UploadedFile`/`@UploadedFiles`):
  1. `req.file` → single `UploadedFileInfo` (or `undefined` when absent);
  2. `req.files` as an array → `UploadedFileInfo[]`;
  3. `req.files` as a fields map (`{ field: File[] }`) → when the optional `field`
     arg is given, return that field's array; otherwise flatten all fields.
- Map each file via a small `toInfo(file)` that reads `file.openBucket` and returns
  `undefined` when it is missing (e.g. a field handled by a different storage engine),
  so a mixed-storage controller degrades gracefully rather than throwing.
- **Edge cases.** No file uploaded → `undefined` (let the handler throw its own
  `BadRequestException('file is required')`, matching the existing README recipe).
  Do not throw from the decorator — decorator-thrown errors bypass exception filters
  cleanly but a `undefined` return is friendlier and consistent with core Nest.
- **Security.** Purely reads already-computed, non-secret fields; surfaces the
  RESOLVED content type (never the client's unverified claim) and never a raw
  credential. `url`, when present, is a time-limited presigned URL minted by
  `uploadFrom` — no long-lived secret is embedded.

## Acceptance criteria
- [ ] `@UploadedToBucket()` on a single-file handler yields `{ bucket, key, url,
      etag, size, contentType }` matching the committed object.
- [ ] On a `FilesInterceptor` (array) handler it yields a `UploadedFileInfo[]`.
- [ ] Returns `undefined` when no file was uploaded (no throw).
- [ ] `nx build nestjs` compiles; `nx test nestjs` for the decorator spec passes.

## Test obligations
- Unit: covered by [TEST-1200] (decorator against a mocked `ExecutionContext`).
- E2E: covered by [TEST-1200] (decorator return asserted in the round-trip app).
- Conformance: N/A.

## Dependencies
- Blocked by: [TASK-3600]

## References
- `libs/nestjs/src/lib/open-bucket.service.ts` `UploadResult` (`:79`), `ImageInfo`
  (`libs/nestjs/src/lib/storage/image-info.ts`, already exported from the barrel).
- `@nestjs/common` `createParamDecorator`, `ExecutionContext`.
- Existing recipe using `@UploadedFile`: `libs/nestjs/README.md` "Recipe".
