---
title: S3 compatibility
description: The matrix of supported S3 operations — buckets, objects, multipart, versioning, tagging, ACL, policy, CORS, lifecycle, object-lock, presign — plus known limitations.
sidebar_position: 3
---

# S3 compatibility

OpenBucket speaks the Amazon S3 wire protocol: **AWS Signature V4** (header and
presigned query), path-style addressing, XML error envelopes, streaming
PUT/GET, multipart uploads, versioning, object lock, tagging, ACL/policy, CORS,
and lifecycle. Point any S3 SDK at it — no special client.

```ts
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

const s3 = new S3Client({
  endpoint: 'http://localhost:9000', // standalone; add `/storage` when embedded
  region: 'us-east-1',               // must match OpenBucket's region option
  forcePathStyle: true,              // REQUIRED — see limitations
  credentials: { accessKeyId, secretAccessKey },
});
await s3.send(new PutObjectCommand({ Bucket: 'my-bucket', Key: 'a.jpg', Body: buf }));
```

The wire surface is exercised by the [conformance suite](https://github.com/ProjectBay/openbucket/tree/main/apps/conformance)
against the real `aws` CLI, MinIO's `mc`, and `s3cmd`.

## Supported operations

### Service & buckets

| Operation | Supported | Notes |
| --- | :-: | --- |
| `ListBuckets` | ✅ | Service-scope `GET`. |
| `CreateBucket` | ✅ | `PUT /:bucket`. |
| `DeleteBucket` | ✅ | Must be empty (`409 BucketNotEmpty` otherwise). |
| `HeadBucket` | ✅ | Existence + region probe. |
| `GetBucketLocation` | ✅ | Returns the configured region. |

### Objects

| Operation | Supported | Notes |
| --- | :-: | --- |
| `PutObject` | ✅ | Streaming PUT, chunked SigV4, checksums. |
| `GetObject` | ✅ | Range reads, conditional headers. |
| `HeadObject` | ✅ | Metadata only. |
| `DeleteObject` | ✅ | Idempotent. |
| `DeleteObjects` | ✅ | Bulk delete (`POST ?delete`). |
| `CopyObject` | ✅ | Via `x-amz-copy-source`. |
| `ListObjects` | ✅ | V1 listing. |
| `ListObjectsV2` | ✅ | `list-type=2`, continuation tokens, delimiter roll-up. |
| `GetObjectAttributes` | ✅ | `GET ?attributes`. |
| `PostObject` | ✅ | Browser-form direct upload (presigned POST). |
| `RestoreObject` | ✅ | `POST ?restore` — rehydrate a tiered object. |

### Multipart uploads

| Operation | Supported | Notes |
| --- | :-: | --- |
| `CreateMultipartUpload` | ✅ | `POST ?uploads`. |
| `UploadPart` | ✅ | `PUT ?uploadId=&partNumber=`. |
| `UploadPartCopy` | ✅ | Part sourced from another object. |
| `CompleteMultipartUpload` | ✅ | |
| `AbortMultipartUpload` | ✅ | |
| `ListParts` | ✅ | `GET ?uploadId=`. |
| `ListMultipartUploads` | ✅ | `GET ?uploads` at bucket scope. |

### Versioning

| Operation | Supported | Notes |
| --- | :-: | --- |
| `GetBucketVersioning` | ✅ | |
| `PutBucketVersioning` | ✅ | Enable / suspend. |
| `ListObjectVersions` | ✅ | `GET ?versions`. |

### Tagging

| Operation | Supported | Notes |
| --- | :-: | --- |
| `GetBucketTagging` / `PutBucketTagging` / `DeleteBucketTagging` | ✅ | Bucket-level tags. |
| `GetObjectTagging` / `PutObjectTagging` / `DeleteObjectTagging` | ✅ | Object-level tags. |

### ACL, policy & encryption

| Operation | Supported | Notes |
| --- | :-: | --- |
| `GetBucketAcl` / `PutBucketAcl` | ✅ | Canned ACLs. |
| `GetObjectAcl` / `PutObjectAcl` | ✅ | |
| `GetBucketPolicy` / `PutBucketPolicy` / `DeleteBucketPolicy` | ✅ | Evaluated by the same policy engine that enforces scoped keys. |
| `GetBucketEncryption` / `PutBucketEncryption` / `DeleteBucketEncryption` | ✅ | SSE-S3 (AES-256) at rest. |

### CORS & lifecycle

| Operation | Supported | Notes |
| --- | :-: | --- |
| `GetBucketCors` / `PutBucketCors` / `DeleteBucketCors` | ✅ | Preflight honoured on the S3 routes. |
| `GetBucketLifecycleConfiguration` / `PutBucketLifecycleConfiguration` / `DeleteBucketLifecycle` | ✅ | Expiration + `<Transition>` (cold-object tiering). |

### Object lock

| Operation | Supported | Notes |
| --- | :-: | --- |
| `GetObjectLockConfiguration` / `PutObjectLockConfiguration` | ✅ | Governance / compliance mode. |
| `GetObjectRetention` / `PutObjectRetention` | ✅ | Per-object retain-until. |
| `GetObjectLegalHold` / `PutObjectLegalHold` | ✅ | Independent hold. |

### Presign

| Capability | Supported | Notes |
| --- | :-: | --- |
| Presigned GET / PUT (query auth) | ✅ | Standard `X-Amz-*` query signing, up to 7-day expiry. |
| Presigned POST (browser form) | ✅ | Policy document with content-type + length-range conditions. |

## Known limitations

:::warning Path-style addressing only
Virtual-host-style addressing (`bucket.host/key`) is **not** supported. Always set
`forcePathStyle: true` in your SDK — requests go to `host/bucket/key`.
:::

- **Single-node.** One Node process over SQLite + the local filesystem. There is
  no built-in multi-node clustering or sharding. Durability beyond the single
  node comes from [async replication](./configuration.md#async-replication) to an
  external S3 target, not from a distributed data plane.
- **`SelectObjectContent`** (`POST ?select`) — not implemented (returns
  `NotImplemented`).
- **`GetObjectTorrent`** (`GET ?torrent`) — not implemented.
- **Read-only bucket subresources** such as accelerate, logging, request-payment,
  and website configuration are recognised but not full features — treat them as
  stubs, not production surfaces.
- **Region.** OpenBucket reports a single configured region (default `us-east-1`);
  it does not emulate cross-region behaviour or redirects.

:::tip Compatibility beyond the AWS SDK
The conformance suite runs the same object round-trips through the `aws` CLI,
MinIO's `mc`, and `s3cmd`, so those tools work against OpenBucket out of the box —
point them at the endpoint with path-style addressing and the root credentials.
:::

## Next steps

- [Configuration](./configuration.md) — region, limits, replication, tiering.
- [OpenBucketService API](./openbucket-service.md) — the in-process alternative to the wire.
- [Admin API](./admin-api.md) — manage buckets, keys, and policies over JSON.
- [CLI reference](./cli-reference.md) — bucket and key management from a terminal.
