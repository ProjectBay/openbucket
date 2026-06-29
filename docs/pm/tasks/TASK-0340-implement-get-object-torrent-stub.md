---
id: TASK-0340
title: Implement GetObjectTorrent NotImplemented stub
story: STORY-0109
status: done
type: implementation
size: XS
---

## Description
Implement `GET /:bucket/:key+?torrent` (`GetObjectTorrent`) as `NotImplemented`.

## Files to create / modify
- `apps/backend/src/s3/controllers/object.controller.ts` — modify (GET family `'torrent' in q` branch)

## Implementation notes
- Route: `| GET  | `/:bucket/:key+` | `torrent` | `GetObjectTorrent` | `NotImplemented`. |` (§2.8.3 line 2563).
- `throw new NotImplementedError('GetObjectTorrent');`.

## Acceptance criteria
- [ ] Returns 501 with `<Code>NotImplemented</Code>` and `<Operation>GetObjectTorrent</Operation>`.

## Test obligations
- Unit: N/A
- E2E: covered by [TEST-0115]
- Conformance: N/A

## Dependencies
- Blocked by: [TASK-0301], [STORY-0105]

## References
- `docs/WHITEPAPER.md` §2.8.3 (line 2563)
