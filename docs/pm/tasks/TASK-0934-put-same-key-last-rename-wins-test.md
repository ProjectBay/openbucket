---
id: TASK-0934
title: Write PUT-same-key last-rename-wins integration test
story: STORY-0312
status: done
type: implementation
size: S
---

## Description
Write an integration test that fires two concurrent PUT requests to the same `bucket/key` with distinct payloads. Both must succeed; the persisted blob and SQLite row must reflect the second writer (last commit wins).

## Files to create / modify
- `apps/backend/test/concurrency.spec.ts` — modify (add this case)

## Implementation notes
- Per §4.8: "Both stream to distinct `tmp/<uuid>.tmp` paths. Both rename to `blobs/<bucket>/<key>`. POSIX `rename(2)` is atomic: the inode swap is instantaneous."
- The "second commit wins" is the SQLite linearization point; the test verifies the ETag returned by GET matches the second writer's MD5.

## Acceptance criteria
- [ ] Both concurrent PUTs return HTTP 200 with their respective ETags.
- [ ] A subsequent GET returns the second writer's payload bytes.
- [ ] The stored ETag (via HEAD) equals the second writer's MD5.

## Test obligations
- Unit: this is part of [TEST-0317]
- E2E: N/A
- Conformance: N/A

## Dependencies
- Blocked by: [TASK-0909]

## References
- `docs/WHITEPAPER.md` §4.8 (line 6182)
