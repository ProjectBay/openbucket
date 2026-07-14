---
slug: aws-signature-v4-from-scratch
title: "AWS Signature V4 from scratch: what it actually takes to speak S3"
description: What we learned implementing server-side SigV4 verification for an S3-compatible store — encoding traps, header folding, chunk signing, and more.
authors: [openbucket]
tags: [s3, sigv4, security, deep-dive, nodejs]
date: 2026-08-26
draft: true
keywords:
  [
    aws signature v4 explained,
    sigv4 canonical request,
    implement sigv4 verification,
    s3 compatible api authentication,
    sigv4 presigned url verification,
    aws chunked upload signing,
  ]
---

Every request an AWS SDK sends to S3 carries an HMAC signature computed over a
_canonical_ rendering of that request. Signing is the easy direction — the SDKs
do it for you, and if you get a detail wrong you find out immediately. Building
an S3-compatible server means doing the opposite: **verifying** signatures from
every client in the wild, where each SDK, CLI, and hand-rolled signer gets a
different detail wrong (or right, in a way your reconstruction has to match
byte-for-byte). One stray space in a header value and the HMACs diverge with
nothing but `SignatureDoesNotMatch` to debug from.

We implemented SigV4 verification from scratch for OpenBucket's S3 endpoint —
header signing, presigned URLs, POST policies, and chunked streaming uploads.
This post walks the algorithm the way the verifier sees it, and collects the
traps we actually hit, with pointers to how the code handles them.

<!-- truncate -->

## The algorithm in one paragraph

SigV4 never transmits the secret key. The client builds a **canonical request**
(a normalized text rendering of the method, path, query, headers, and payload
hash), hashes it into a **string to sign**, derives a **signing key** from the
secret through a chain of HMACs, and sends `hex(HMAC-SHA256(signingKey,
stringToSign))` in the `Authorization` header. The server holds the same secret,
rebuilds the exact same canonical request from the raw HTTP request, re-derives
the key, and compares signatures. Symmetric — which means _every_ normalization
rule is a place where the two sides can disagree.

```text
CanonicalRequest =
  HTTPMethod \n
  CanonicalURI \n
  CanonicalQueryString \n
  CanonicalHeaders \n
  SignedHeaders \n
  HashedPayload
```

## The canonical URI: encoding is where hope goes to die

SigV4 mandates an AWS-flavored RFC 3986 encoding: only `A–Z a–z 0–9 - _ . ~`
pass through, everything else is percent-encoded **per UTF-8 byte** with
uppercase hex. `encodeURIComponent` is close but not equal (it leaves `!'()*`
unescaped), so we wrote it out longhand:

```ts
// canonical-request.ts — byte-by-byte, uppercase hex, '/' preserved in paths
for (const byte of Buffer.from(input, 'utf8')) {
  // unreserved chars pass; '/' passes only when encodeSlash === false
  out.push('%' + byte.toString(16).toUpperCase().padStart(2, '0'));
}
```

Two traps hide here:

1. **S3 single-encodes; most other AWS services double-encode.** For S3 the
   canonical URI is the path with each segment encoded exactly once, slashes
   preserved. Our verifier splits the path on `/`, encodes each segment, and
   rejoins — never encoding the separators themselves.
2. **Your framework already decoded the URL once.** Express hands you a decoded
   path, so the verifier reconstructs the canonical form by re-encoding from
   `req.originalUrl` rather than trusting the routed params. An object key
   like `résumé (1).pdf` has to round-trip to `r%C3%A9sum%C3%A9%20%281%29.pdf`
   — UTF-8 bytes, encoded space, encoded parens — or the hashes diverge.

The query string gets its own normalization: split on `&`, decode each key and
value, re-encode both with the strict encoder (slashes encoded this time), then
sort **by key, and by value for duplicate keys**. Keys with no `=` become
`key=` with an empty value — S3 subresources like `?versioning` are exactly
this shape, so getting the empty-value case wrong breaks half the bucket API.

## Canonical headers: lowercase, trim, fold

Each signed header contributes one line: name lowercased, value trimmed, and
**sequential internal whitespace collapsed to a single space**. Multi-value
headers are joined with commas. The client tells you which headers it signed
via the `SignedHeaders` list — and that list is itself part of the canonical
request.

Which raises an uncomfortable question: what if a client just… leaves headers
out of the list? A signature that doesn't cover `host` isn't bound to your
endpoint, and an unsigned `x-amz-*` header could be altered in flight without
invalidating anything. AWS rejects such requests, and so do we — the verifier
requires `host` in `SignedHeaders` and requires every `x-amz-*` header actually
present on the wire to be signed. Every mainstream SDK already does this, so
the check only bites forged or tampered requests.

One more parsing landmine: the `Authorization` header's
`Credential=…, SignedHeaders=…, Signature=…` directives are attacker-controlled
key–value pairs. Ours parse into a null-prototype object against an explicit
allowlist of those three names, so a crafted `__proto__=…` directive can't
reach `Object.prototype`. There's a regression test that tries.

## The payload hash — and the streaming rabbit hole

The last canonical-request line is `x-amz-content-sha256`: either the hex
SHA-256 of the body or one of several magic strings. Counterintuitively, **the
verifier takes this value verbatim and never recomputes it over the body** —
the header is itself in `SignedHeaders`, so a lie about the payload hash breaks
the signature on its own. Recomputing would also force buffering a possibly
multi-gigabyte PUT before authenticating it.

The values OpenBucket accepts:

- **A hex SHA-256** — classic signed payload.
- **`UNSIGNED-PAYLOAD`** — the body isn't covered by the signature (standard
  for presigned URLs, and common over TLS).
- **`STREAMING-AWS4-HMAC-SHA256-PAYLOAD`** — aws-chunked signed streaming. The
  header signature becomes a _seed_, and each body chunk carries its own
  signature chaining from the previous one:

```text
chunkStringToSign =
  AWS4-HMAC-SHA256-PAYLOAD \n
  <amzDate> \n <credentialScope> \n
  <previousSignature> \n
  SHA256("") \n
  SHA256(chunkData)
```

  The guard verifies the seed like any header signature, then stashes the
  derived signing key so the chunk decoder can verify the rolling chain — the
  final zero-length chunk signs the empty hash and closes it.
- **`STREAMING-UNSIGNED-PAYLOAD-TRAILER`** — unsigned chunks with a trailing
  checksum, the aws-cli v2 default.

What it does **not** support: `STREAMING-AWS4-HMAC-SHA256-PAYLOAD-TRAILER`,
the signed-trailer variant. That one is rejected explicitly with an
`InvalidArgument` naming the header, instead of a baffling signature mismatch —
if you must fail, fail with a diagnosis.

## Deriving the signing key

The secret never signs anything directly. It's stretched through a dated,
scoped HMAC chain:

```ts
// sigv4.verifier.ts
const kDate = hmac(`AWS4${secretAccessKey}`, date); // e.g. '20260826'
const kRegion = hmac(kDate, region);
const kService = hmac(kRegion, service); // 's3'
const kSigning = hmac(kService, 'aws4_request');
```

The scope (`date/region/service/aws4_request`) comes from the client's
`Credential` and is signed into the string to sign, so you can't replay a
signature across days, regions, or services. One derivation function is shared
by all four verification paths — header, presigned, POST policy, and chunk
chain — because two implementations of key derivation is how you get one subtle
disagreement.

Replay is further bounded by a clock check: `X-Amz-Date` must be within **±15
minutes** of server time (AWS's window), or the request is rejected with
`RequestTimeTooSkewed`. Our tests pin the boundary: ±14 minutes passes, ±16
fails.

Finally, the comparison itself: signatures are compared with
`crypto.timingSafeEqual` over UTF-8 bytes, and an unknown access key returns
the same generic `SignatureDoesNotMatch` as a wrong secret — no timing oracle
on the signature, no existence oracle on key IDs.

## Presigned URLs: the same dance in query params

`aws s3 presign` moves everything into `X-Amz-*` query parameters. Verification
differs in three ways:

1. **The signature lives in `X-Amz-Signature`** — which must be stripped from
   the canonical query before rebuilding it, while every _other_ `X-Amz-*`
   param stays in.
2. **The payload hash is always `UNSIGNED-PAYLOAD`** — the URL is minted before
   any body exists.
3. **Expiry is explicit.** `X-Amz-Expires` must be between 1 second and 7 days
   (AWS's cap), and the request must land inside
   `[X-Amz-Date, X-Amz-Date + expires]` — with the 15-minute skew allowance
   applied only to the start, so a future-dated URL is tolerated but a lapsed
   one is dead. Expired URLs get AWS's exact phrasing: `AccessDenied` with
   "Request has expired".

Since a presigned URL _is_ a bearer credential for its window, one non-obvious
consequence: request logs. OpenBucket strips `X-Amz-Signature`,
`X-Amz-Credential`, and `X-Amz-Security-Token` from every logged URL, so a
leaked log file isn't a pile of replayable requests.

## Why grind through all this?

Because SigV4 _is_ the compatibility bar. "S3-compatible" doesn't mean "has
buckets and objects" — it means the unmodified AWS SDK, aws-cli, and every
S3-speaking tool can sign a request and have it verify, including the weird
corners: unicode keys, duplicate query params, chunked streams, presigned
expiry. Our unit tests cross-check the verifier against the `aws4` signing
library and reproduce the AWS-published GET-Object reference signature
byte-for-byte, and a separate conformance suite (`apps/conformance/`) plus
e2e tests drive the real SDK and CLI against a running instance — the only
proof that actually counts.

If you're evaluating an S3-compatible store, the supported surface is
documented honestly in the [S3 compatibility
reference](/docs/reference/s3-compatibility), and the full protocol design —
routing, XML envelopes, the error taxonomy around all of the above — is in the
[whitepaper chapter on S3 & SigV4](/docs/whitepaper/02-s3-protocol-and-sigv4).
For the friendlier face of presigning, see [sharing
files](/docs/guides/sharing-files).

---

Building in this space too, or spotted a SigV4 corner we missed? Tell us in
[Discussions](https://github.com/ProjectBay/openbucket/discussions) — and if
this deep-dive was worth your scroll, a star on
[github.com/ProjectBay/openbucket](https://github.com/ProjectBay/openbucket)
helps the project reach the next person debugging `SignatureDoesNotMatch` at
midnight.
