---
id: TASK-2142
title: Paginate ListParts and report MaxParts/IsTruncated truthfully
story: STORY-0704
status: ready
type: implementation
size: S
---

## Description
Remediates audit finding #13 (LOW, **CWE-770** Allocation of Resources Without Limits
or Throttling — primarily an S3 spec-conformance bug with a minor resource amplifier).
`listParts()` runs an unbounded `em.find(MultipartPart, { upload }, ...)` and serializes
every row into one XML string while hardcoding `MaxParts: 1000` and `IsTruncated: false`,
ignoring the client's `max-parts` and `part-number-marker` query parameters. A maxed-out
upload (up to 10,000 parts) materializes a multi-MB document per request regardless of the
requested page size, and the truncation fields are simply wrong. This Task implements real
DB-level pagination and truthful response metadata.

## Files to create / modify
- `libs/nestjs/src/lib/domain/multipart/multipart.service.ts` — modify `listParts`
  (`:357`–`:387`): parse and clamp `max-parts`/`part-number-marker`, push them into the
  DB query, and compute `IsTruncated`/`NextPartNumberMarker`.
- `libs/nestjs/src/lib/s3/controllers/multipart.controller.ts` — modify: pass the
  `max-parts` and `part-number-marker` query params through to `listParts` (the current
  signature is `listParts(_req, res, bucket, key, uploadId)`).

## Implementation notes
- Vulnerable code at `multipart.service.ts:367`:
  `const parts = await em.find(MultipartPart, { upload }, { orderBy: { partNumber: 'ASC' } });`
  with no `limit`, followed by `MaxParts: 1000, IsTruncated: false` hardcoded at
  `:374`–`:375`.
- Fix per the audit fix-note: parse `max-parts` (default `1000`, clamp to `[1, 1000]`)
  and `part-number-marker` (integer, default `0`) from the query, then:
  ```ts
  const rows = await em.find(
    MultipartPart,
    { upload, partNumber: { $gt: marker } },
    { orderBy: { partNumber: 'ASC' }, limit: maxParts + 1 },
  );
  const isTruncated = rows.length > maxParts;
  const page = isTruncated ? rows.slice(0, maxParts) : rows;
  const nextMarker = isTruncated ? page[page.length - 1].partNumber : undefined;
  ```
  Fetch `maxParts + 1` rows so the extra row signals truncation. Emit `MaxParts` as the
  effective requested value, include `PartNumberMarker` in the response, and set
  `NextPartNumberMarker` only when `IsTruncated` is true.
- The 10,000-part ceiling is preserved by `upsertPart` last-writer-wins on
  `(upload, partNumber)`; pagination bounds each *response* to the requested page size.

## Acceptance criteria
- [ ] `ListParts?max-parts=2` on an upload with 5 parts returns exactly 2 `Part`
      elements, `IsTruncated=true`, and `NextPartNumberMarker` equal to the 2nd part
      number.
- [ ] Passing that `NextPartNumberMarker` as `part-number-marker` returns the next page.
- [ ] `MaxParts` in the response echoes the effective (clamped) requested value, not a
      hardcoded `1000`, and `IsTruncated=false` on the final page.
- [ ] `nx test nestjs --testPathPattern=multipart` passes.

## Test obligations
- Unit: covered by [TEST-0704] (paging math, clamp, truthful IsTruncated)
- E2E: covered by [TEST-0704] (aws-cli/SDK ListParts over a real multipart upload)
- Conformance: covered by [TEST-0704] (S3 ListParts pagination semantics)

## Dependencies
- Blocked by: [TASK-2100], [STORY-0700]

## References
- White-box security audit, 2026-07-04 — finding #13 (CWE-770).
- `libs/nestjs/src/lib/domain/multipart/multipart.service.ts:357-387` (`listParts`), `:367,374`.
- `libs/nestjs/src/lib/s3/controllers/multipart.controller.ts`
</content>
