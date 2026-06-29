---
id: TASK-0363
title: Implement ListObjectsV2 handler with cursor decode/encode
story: STORY-0118
status: done
type: implementation
size: M
---

## Description
Implement `ListObjectsV2` handler (`GET /:bucket?list-type=2`) on `ObjectService.listObjectsV2`. SQL belongs to EPIC-03; this Task owns the request decode/encode and response shaping.

## Files to create / modify
- `apps/backend/src/domain/objects/object.service.ts` — modify (add `listObjectsV2`)
- `apps/backend/src/s3/controllers/bucket.controller.ts` — modify (wire `?list-type=2` branch)

## Implementation notes
- Route: `| GET  | `/:bucket` | `list-type=2` | `ListObjectsV2` | Default for modern clients. See §2.10. |` (§2.8.2 line 2509).
- Apply `@S3Operation('ListObjectsV2')`.
- Pseudocode from §2.10 (lines 2773–2807):
  ```ts
  const cursor = req.query['continuation-token']
    ? this.tokens.decode(String(req.query['continuation-token']), bucket)
    : null;

  const rows = await this.repo.listObjects({
    bucket,
    prefix: cursor?.prefix ?? (req.query.prefix as string) ?? '',
    afterKey: cursor?.afterKey ?? (req.query['start-after'] as string) ?? '',
    delimiter: cursor?.delimiter ?? (req.query.delimiter as string | undefined) ?? null,
    limit: maxKeys + 1,
  });

  const truncated = rows.length > maxKeys;
  const page = rows.slice(0, maxKeys);
  const nextToken = truncated
    ? this.tokens.encode({ v: 1, b: bucket, afterKey: page[page.length - 1].key, prefix: ..., delimiter: ... })
    : null;

  return {
    __root: 'ListBucketResult',
    Name: bucket,
    Prefix: req.query.prefix ?? '',
    MaxKeys: maxKeys,
    KeyCount: page.length,
    IsTruncated: truncated,
    NextContinuationToken: nextToken ?? undefined,
    Contents: page.map(/* … */),
  };
  ```
- `maxKeys`: default 1000, capped at 1000.

## Acceptance criteria
- [ ] `?list-type=2` returns `<ListBucketResult>` with `KeyCount`, `IsTruncated`, `NextContinuationToken` (only when truncated).
- [ ] `?continuation-token=…` decoded via `ContinuationToken.decode`.
- [ ] Tampered token → 400 `InvalidArgument`.
- [ ] No token leakage when `IsTruncated = false`.

## Test obligations
- Unit: N/A
- E2E: covered by [TEST-0135]
- Conformance: covered by [TEST-0136]

## Dependencies
- Blocked by: [TASK-0362], [TASK-0302], [EPIC-03]

## References
- `docs/WHITEPAPER.md` §2.10 (lines 2689–2814), §2.8.2 (line 2509)
