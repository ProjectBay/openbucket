---
id: TASK-3604
title: Extend the README with the one-line multer storage recipe
story: STORY-1200
status: backlog
type: docs
size: S
---

## Description
Extend the `@openbucket/nestjs` README so the file-upload recipe shows the new
one-line `storage: openBucketStorage(ob, …)` wiring next to the existing
`uploadFrom` recipe, and cross-link it from the root README. Keep the security
guidance (rejected-uploads → 400, key-safety, presign-on-read) intact.

## Files to create / modify
- `libs/nestjs/README.md` — modify (add a "One-line multer storage" subsection to
  the "Recipe: accept file uploads and store their URLs" section)
- `README.md` — modify (extend the "Recipe: file uploads → your database" snippet
  with the one-line variant + a link to the library README)

## Implementation notes
- **New subsection sketch** (place after the existing `uploadFrom` controller, so
  readers see the manual path first, then the drop-in):
  ````md
  #### One-line wiring: the multer storage engine

  If your app already uses `FileInterceptor`, swap its storage for OpenBucket —
  the file streams straight into the store (no temp file, no `uploadFrom` call):

  ```ts
  import { FileInterceptor } from '@nestjs/platform-express';
  import { OpenBucketService } from '@openbucket/nestjs';
  import {
    openBucketStorage,
    UploadedToBucket,
    UploadedFileInfo,
    UploadValidationExceptionFilter,
  } from '@openbucket/nestjs/multer';

  @Controller('files')
  @UseFilters(UploadValidationExceptionFilter) // maps a rejected upload → 400
  export class FilesController {
    constructor(private readonly ob: OpenBucketService) {}

    @Post()
    @UseInterceptors(
      FileInterceptor('file', {
        storage: openBucketStorage(this.ob, {   // ← one line
          bucket: 'uploads',
          key: 'uuid',
          validate: { maxBytes: 10 * 1024 * 1024, allowedContentTypes: ['image/*'] },
        }),
      }),
    )
    upload(@UploadedToBucket() file: UploadedFileInfo) {
      // `file` is already committed to OpenBucket: { bucket, key, url, etag, size, contentType }
      return { key: file.key, url: file.url };
    }
  }
  ```
  ````
- **Note the `this.ob` caveat.** `openBucketStorage` needs the `OpenBucketService`
  instance; inside a class-property `@UseInterceptors` decorator `this` is not
  available at decoration time — document the standard Nest fix: build the storage
  in a small factory/provider or use `FileInterceptor` inside a custom mixin, OR
  pass a module-scoped `ob` obtained via a provider. Show the DI-friendly pattern
  (a provider that returns the interceptor) so the copy-paste actually runs.
- Keep and cross-reference the existing guidance blocks: the
  "Rejected uploads → 400" note now points at `UploadValidationExceptionFilter`;
  the "presign-on-read" and "store the key, not the URL" guidance stays as the
  recommended persistence pattern (the engine attaches `url` but a stored key +
  presign-on-read is still the robust default).
- Mention `@openbucket/nestjs/multer` is a **subpath** export and `multer` an
  optional peer (already present via `@nestjs/platform-express`).
- Update the root `README.md` recipe (`:222`–`:248`) to show the one-liner and
  link to the library section, keeping the manual `putObject` snippet as the
  lower-level alternative.

## Acceptance criteria
- [ ] `libs/nestjs/README.md` contains a runnable one-line `storage:
      openBucketStorage(...)` recipe importing from `@openbucket/nestjs/multer`.
- [ ] The DI caveat (`this.ob` inside a decorator) is addressed with a working pattern.
- [ ] The "rejected uploads → 400" guidance references `UploadValidationExceptionFilter`.
- [ ] Root `README.md` links to the library recipe and shows the one-liner.
- [ ] No secret/credential appears in any new snippet.

## Test obligations
- Unit: N/A — docs.
- E2E: N/A — docs (the snippets are exercised in spirit by [TEST-1200]).
- Conformance: N/A.

## Dependencies
- Blocked by: [TASK-3600], [TASK-3601], [TASK-3602], [TASK-3603]

## References
- `libs/nestjs/README.md` — "Recipe: accept file uploads and store their URLs"
  (`:453`–`:576`), the "Rejected uploads → 400" note (`:542`).
- `README.md` — "Recipe: file uploads → your database" (`:222`–`:248`).
