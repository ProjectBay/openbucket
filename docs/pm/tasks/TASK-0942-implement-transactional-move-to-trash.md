---
id: TASK-0942
title: Implement per-batch transactional moveToTrash
story: STORY-0314
status: done
type: implementation
size: XS
---

## Description
Inside the sweep loop, filter the page by `isExpired`, and when at least one object is expired wrap a single `em.transactional(async (em) => { for ... await this.objects.moveToTrash({ em, bucket, key }); })` call. Log the batch result.

## Files to create / modify
- `apps/backend/src/common/background/lifecycle-sweep.runner.ts` — modify

## Implementation notes
- Verbatim per §4.10:
  ```ts
  const expired = page.filter((obj) => this.isExpired(obj, rule, now));
  if (expired.length > 0) {
    await this.em.transactional(async (em) => {
      for (const obj of expired) {
        await this.objects.moveToTrash({ em, bucket: obj.bucket, key: obj.key });
      }
    });
    this.log.log(`Rule ${rule.ruleId} expired ${expired.length}/${page.length} in batch`);
  }
  ```

## Acceptance criteria
- [ ] `em.transactional` wraps the per-batch `moveToTrash` loop.
- [ ] `moveToTrash` is called with `{ em, bucket: obj.bucket, key: obj.key }`.
- [ ] Log line `Rule <ruleId> expired N/M in batch` is emitted when at least one expired.

## Test obligations
- Unit: covered by [TEST-0319]
- E2E: covered by [TEST-0320]
- Conformance: N/A

## Dependencies
- Blocked by: [TASK-0941]

## References
- `docs/WHITEPAPER.md` §4.10 (lines 6393–6405)
