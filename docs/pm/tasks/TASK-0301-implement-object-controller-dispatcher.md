---
id: TASK-0301
title: Implement ObjectController dispatcher
story: STORY-0100
status: done
type: implementation
size: M
---

## Description
Implement the ObjectController dispatcher per §2.1.1. Each verb method examines the query string and headers and fans out to the matching domain service method. The `:bucketOrKey` param is a decoy — actual bucket/key come from `RouteResolver.resolve(req)`.

## Files to create / modify
- `apps/backend/src/s3/controllers/object.controller.ts` — modify (implement)

## Implementation notes
- Verbatim signatures from §2.1.1 (lines 1117–1230):
  - `@Controller() @UseGuards(SigV4Guard) @UseFilters(S3ExceptionFilter) @UseInterceptors(XmlInterceptor) export class ObjectController`
  - PUT family: `@Put(':bucketOrKey/*')` and `@Put(':bucketOrKey')` dispatches on `q.uploadId !== undefined && q.partNumber !== undefined`, `x-amz-copy-source` header, `'tagging' in q`, `'acl' in q`, `'retention' in q`, `'legal-hold' in q`, then plain `putObject`.
  - GET family: dispatches on `'tagging'`, `'acl'`, `'retention'`, `'legal-hold'`, then `q.uploadId !== undefined` → `multipart.listParts`, else `getObject`.
  - HEAD family: `headObject`.
  - POST family: `'uploads' in q` → `createUpload`; `q.uploadId` → `completeUpload`; `'restore' in q` → `restoreObject`; `'select' in q` → `throw new NotImplementedError('SelectObjectContent')`; else `postObject`.
  - DELETE family: `q.uploadId !== undefined` → `abortUpload`; `'tagging' in q` → `deleteTagging`; else `deleteObject`.
- Inject `ObjectService`, `MultipartService`, `RouteResolver`.

## Acceptance criteria
- [ ] All dispatch branches from §2.1.1 are wired in the exact order shown in the white paper.
- [ ] Controllers do not parse URLs — they call `this.routes.resolve(req)`.
- [ ] `nx test backend --testPathPattern=object.controller.spec.ts` passes a dispatcher matrix.

## Test obligations
- Unit: covered by [TEST-0100]
- E2E: covered transitively by [TEST-0115], [TEST-0117], [TEST-0119]
- Conformance: N/A

## Dependencies
- Blocked by: [TASK-0300], [TASK-0307], [STORY-0103], [STORY-0102], [STORY-0106]

## References
- `docs/WHITEPAPER.md` §2.1.1 (lines 1117–1230)
