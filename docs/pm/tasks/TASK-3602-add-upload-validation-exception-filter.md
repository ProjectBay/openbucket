---
id: TASK-3602
title: Add the UploadValidationError to HTTP 400 multer exception filter
story: STORY-1200
status: backlog
type: implementation
size: S
---

## Description
When the storage engine (TASK-3600) rejects an upload, `uploadFrom` throws
`UploadValidationError` (`statusHint = 400`). multer/Nest re-throw that raw error
out of `FileInterceptor`, where Nest's default handling would render it as an
opaque `500`. Provide an opt-in Nest exception filter that maps
`UploadValidationError` to a `400` with a stable body, so the one-line wiring
produces correct HTTP semantics without every host writing the mapping by hand.

## Files to create / modify
- `libs/nestjs/src/lib/adapters/multer/upload-validation.filter.ts` — new
- `libs/nestjs/src/lib/adapters/multer/index.ts` — modify (re-export the filter)

## Implementation notes
- **Filter sketch:**
  ```ts
  @Catch(UploadValidationError)
  export class UploadValidationExceptionFilter implements ExceptionFilter {
    catch(err: UploadValidationError, host: ArgumentsHost) {
      const res = host.switchToHttp().getResponse<Response>();
      res.status(err.statusHint /* 400 */).json({
        statusCode: err.statusHint,
        error: 'Bad Request',
        code: err.code,          // stable union: too_large | active_content |
                                 //   type_not_allowed | no_content_type | invalid_key
        message: err.message,    // human-readable; carries no secret
      });
    }
  }
  ```
- **Register per-handler or globally**, host's choice — document both:
  `@UseFilters(UploadValidationExceptionFilter)` on the controller, or
  `app.useGlobalFilters(new UploadValidationExceptionFilter())`. The filter is
  scoped by `@Catch(UploadValidationError)`, so it never intercepts the host's
  own errors or OpenBucket S3 wire errors.
- **Scope discipline / no double-mapping.** `UploadValidationError` is deliberately
  distinct from the S3 domain errors (see the class doc in
  `open-bucket-upload.ts:60`–`75`): the S3 exception filter only renders requests
  under `mountPath`, so this host-route filter and the wire filter never overlap.
- **Non-validation errors pass through.** An S3 domain error thrown by
  `uploadFrom` (e.g. `NoSuchBucketError` when the bucket is absent) is NOT caught
  here — it falls through to the host's own filters. Document that the bucket must
  exist (the README bootstrap snippet), or the host maps `NoSuchBucketError` itself.
- **Security / redaction.** `err.message` is composed from validation facts
  (byte counts, the normalized content type) — never a credential, signature, or
  the object body. The filter must not echo request headers or the Authorization
  header. `err.code` is a fixed enum safe to expose to clients. This preserves the
  EPIC-08 secret-redaction posture on the host-app error path.
- Alternatively a host can skip the filter and read `statusHint` in its own
  `catch` (`if (err instanceof UploadValidationError) throw new BadRequestException(...)`);
  document that path too, matching the existing README note (`README.md:542`).

## Acceptance criteria
- [ ] Posting an oversize / disallowed-type / active-content file through the
      wired `FileInterceptor` with the filter installed returns HTTP `400` with
      `{ code, message }`, not `500`.
- [ ] A `NoSuchBucketError` from `uploadFrom` is NOT swallowed by the filter.
- [ ] The response body contains no credential, signature, or request-header value.
- [ ] `nx test nestjs` for the filter spec passes.

## Test obligations
- Unit: covered by [TEST-1200] (filter maps error → 400 body).
- E2E: covered by [TEST-1200] (rejected upload returns 400 through the app).
- Conformance: N/A.

## Dependencies
- Blocked by: [TASK-3600]

## References
- `libs/nestjs/src/lib/open-bucket-upload.ts` `UploadValidationError`
  (`statusHint = 400`, `code` union `:52`–`:75`).
- `libs/nestjs/README.md:542` — existing "Rejected uploads → 400" note.
- `@nestjs/common` `ExceptionFilter`, `@Catch`, `ArgumentsHost`.
