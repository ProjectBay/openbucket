---
id: TASK-2434
title: Rewrite the README upload recipe to use the helpers
story: STORY-0803
status: backlog
type: docs
size: S
---

## Description
Rewrite the "Recipe: accept file uploads and store their URLs" section of the library
README so the upload endpoint uses `uploadFrom` instead of hand-wiring key generation,
`putObject`, and validation. The recipe should shrink by roughly half while keeping the
robust "store the stable `{ bucket, key }`, presign on read" guidance intact.

## Files to create / modify
- `libs/nestjs/README.md` — modify. The `### Recipe: accept file uploads and store their
  urls` section (currently ~lines 179–287) and the facade method inventory paragraph
  (~lines 135–139) to mention `uploadFrom`.

## Implementation notes
- Replace the step-2 controller body. Before (today) it does: null-check, manual
  `${year}/${uuid}${extname}` key, `putObject(BUCKET, key, file.buffer, { contentType: file.mimetype })`,
  then a DB insert. After:
  ```ts
  @Post()
  @UseInterceptors(FileInterceptor('file'))
  async upload(@UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException('file is required');

    // Sniffs the real content type, enforces size/type, picks a safe key — one call.
    const { key, contentType, size, image } = await this.ob.uploadFrom(file, {
      bucket: BUCKET,
      keyStrategy: 'uuid',
      validate: { maxBytes: 10 * 1024 * 1024, allowedContentTypes: ['image/*'] },
    });

    const saved = await this.db.file.create({
      data: { bucket: BUCKET, key, name: file.originalname, size, contentType,
              width: image?.width, height: image?.height },
    });
    return this.toDto(saved);
  }
  ```
- Note that `UploadValidationError` (thrown on a too-large / disallowed / active-content
  upload) should be mapped to a `400` — show a one-line `instanceof` mapping or reference
  the `statusHint`.
- Keep step 1 (bootstrap bucket) and step 3 (presign on read via `toDto`) as-is; keep the
  "I just want a URL column" aside and the streaming/large-file note (uploadFrom accepts a
  `Readable` too — update that note to say so instead of "pass a `Readable` to putObject").
- Update the facade inventory sentence ("The facade covers: `putObject`, …") to include
  `uploadFrom`.
- Do not remove the low-level `putObject` docs — `uploadFrom` is sugar on top, and
  `putObject` stays the primitive for callers who want no validation/sniffing.
- Keep the security guidance intact: still store the stable key (not a signed URL), still
  presign on read. Optionally add one sentence that `uploadFrom` sniffs the content type
  and rejects mismatched active content as defense in depth.

## Acceptance criteria
- [ ] The recipe's upload handler uses `uploadFrom` and is materially shorter than the
  current version (manual key building + `putObject` + separate validation removed).
- [ ] The doc mentions `validate` (maxBytes + allowedContentTypes) and `image` metadata.
- [ ] The facade inventory lists `uploadFrom`.
- [ ] The "store the key, presign on read" guidance and the large-file/stream note remain.
- [ ] Markdown lints/renders (no broken code fences); `nx build nestjs` unaffected.

## Test obligations
- Unit: N/A — docs. The code sample must compile against the [TASK-2433] signatures
  (reviewer cross-checks types; optionally covered by a doc-snippet test if the repo has one).
- E2E: N/A.
- Conformance: N/A.

## Dependencies
- Blocked by: [TASK-2433] (the recipe must match the shipped `uploadFrom` signature).

## References
- `libs/nestjs/README.md#recipe-accept-file-uploads-and-store-their-urls` (current recipe).
- `libs/nestjs/src/lib/open-bucket.service.ts` — `uploadFrom` (source of truth for the sample).
- `docs/pm/epics/EPIC-09-developer-upload-pipeline.md` — success criterion: "the docs'
  upload recipe is rewritten to use the new helpers and shrinks by ~half".
