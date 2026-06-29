---
id: TASK-0902
title: Implement PutObjectStreamContext and IncomingMessage augmentation
story: STORY-0301
status: done
type: implementation
size: XS
---

## Description
Define the `PutObjectStreamContext` interface and the `declare module 'http'` augmentation that adds `openbucketPutCtx?: PutObjectStreamContext` to `IncomingMessage`, so handlers can read the verified stream and the pending hash/size promises from `req`.

## Files to create / modify
- `apps/backend/src/s3/object/put-object.interceptor.ts` — new (scaffold; later tasks add behavior)

## Implementation notes
- Verbatim interface from §4.1.2:
  ```ts
  export interface PutObjectStreamContext {
    readonly stream: NodeJS.ReadableStream;
    readonly hashes: Promise<{ md5Hex: string; md5Base64: string; sha256Hex: string }>;
    readonly size: Promise<number>;
  }
  ```
- Verbatim module augmentation:
  ```ts
  declare module 'http' {
    interface IncomingMessage {
      openbucketPutCtx?: PutObjectStreamContext;
    }
  }
  ```

## Acceptance criteria
- [ ] `PutObjectStreamContext` is exported.
- [ ] `IncomingMessage` typing is extended with the optional field.
- [ ] `nx build backend` compiles.

## Test obligations
- Unit: covered by [TEST-0301]
- E2E: covered by [TEST-0304]
- Conformance: covered by [TEST-0302]

## Dependencies
- Blocked by: [TASK-0900]

## References
- `docs/WHITEPAPER.md` §4.1.2 (lines 5271–5285)
