---
id: TASK-0362
title: Implement ContinuationToken (HMAC-sealed token)
story: STORY-0118
status: done
type: implementation
size: M
---

## Description
Implement `ContinuationToken` per §2.10 — base64url(JSON.stringify(cursor) || HMAC(secret, payload)[0..12]). Per-process secret derived once at boot.

## Files to create / modify
- `apps/backend/src/s3/pagination/continuation-token.ts` — new

## Implementation notes
- Verbatim from §2.10 (lines 2702–2766):
  ```ts
  /** What the server needs to resume a list. Opaque to clients. */
  export interface ListCursor {
    /** The bucket the list is in. Used to detect token reuse across buckets. */
    b: string;
    /** Key to start *after*. S3 semantics: continuation excludes this key. */
    afterKey: string;
    /** Delimiter that was in force when the token was issued. */
    delimiter: string | null;
    /** Prefix that was in force. */
    prefix: string;
    /** Version 1 = ListObjectsV2 ordering by key. */
    v: 1;
  }

  @Injectable()
  export class ContinuationToken implements OnModuleInit {
    private secret!: Buffer;

    onModuleInit(): void {
      this.secret = crypto.randomBytes(32);
    }

    encode(cursor: ListCursor): string {
      const payload = Buffer.from(JSON.stringify(cursor), 'utf8');
      const mac = crypto.createHmac('sha256', this.secret).update(payload).digest().subarray(0, 12);
      return Buffer.concat([payload, mac]).toString('base64url');
    }

    decode(token: string, expectedBucket: string): ListCursor { /* timingSafeEqual + v/b checks */ }
  }
  ```
- Decode validates: base64url parse, `buf.length >= 12`, `timingSafeEqual(mac, expected)`, JSON parse, `cursor.v === 1`, `cursor.b === expectedBucket`. Any mismatch → `InvalidArgumentError`.
- Per §2.10 lines 2697–2700: "token validity is guaranteed only for the current process lifetime, which matches S3's informal contract".

## Acceptance criteria
- [ ] `encode → decode` round-trips a cursor with the same bucket.
- [ ] Tampered payload → `InvalidArgumentError('continuation token failed validation', 'continuation-token', token)`.
- [ ] Cross-bucket token → `InvalidArgumentError('continuation token does not belong to this listing', 'continuation-token', token)`.
- [ ] Wrong `v` → `InvalidArgumentError`.
- [ ] Comparison uses `crypto.timingSafeEqual`.

## Test obligations
- Unit: covered by [TEST-0134]
- E2E: covered by [TEST-0135]
- Conformance: N/A

## Dependencies
- Blocked by: [TASK-0300], [STORY-0105]

## References
- `docs/WHITEPAPER.md` §2.10 (lines 2689–2766)
