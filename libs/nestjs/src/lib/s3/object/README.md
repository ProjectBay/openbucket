# Streaming hot path — backpressure rules

The object PUT/GET/UploadPart paths stream bytes without buffering. The backpressure
chain (TCP → IncomingMessage → verifier Transform → fs WriteStream → disk) is
automatic, but depends on three explicit `highWaterMark: 256 * 1024` settings and
three things we **never** do. See WHITEPAPER §4.7.

## The three tuned highWaterMark sites (all `256 * 1024`)

1. **`PutObjectInterceptor`'s verifier `Transform`** (`object/put-object.interceptor.ts`) —
   larger than the 16 KB default so we don't ping-pong paused/resumed per TCP segment;
   smaller than 1 MiB so we don't hold a megabyte per in-flight upload.
2. **GET read stream** — `BlobStore.getBlob`'s `createReadStream` (`storage/blob-store.ts`).
3. **UploadPart write stream** — `BlobStore.putPart`'s `createWriteStream` (`storage/blob-store.ts`).

## Never

- **Never** call `req.on('data', …)` on the request — it switches the stream into
  flowing mode and bypasses backpressure entirely.
- **Never** accumulate chunks into an in-memory `Buffer[]` and concatenate at end —
  that is exactly what Express's default body-parser does, and why we disabled it.
- **Never** `await` work inside a `_transform` that isn't tied to the chunk being
  processed — it gives the Transform's queue an unbounded growth path (it can't apply
  backpressure to itself).

## Invariant

At any moment the maximum buffered bytes per in-flight PUT is roughly
`(TCP recv buf) + 256 KB (verifier) + 256 KB (writable) ≈ 1 MiB`. 100 concurrent
multi-GB PUTs ≈ 100 MiB of in-flight buffer — comfortable in a 512 MiB container.

The memory probe in `backpressure.spec.ts` (gated behind `OPENBUCKET_MEM_PROBE=1`)
streams a 1 GiB body through the verifier and asserts RSS stays bounded.
