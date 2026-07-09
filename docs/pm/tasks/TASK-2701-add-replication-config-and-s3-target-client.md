---
id: TASK-2701
title: Add replication config/options and the S3-compatible target client
story: STORY-0900
status: backlog
type: implementation
size: M
---

## Description

Add the dual-surface configuration (standalone env + library `forRoot` options)
that describes the external replication target, and a thin
`ReplicationTargetService` that wraps `@aws-sdk/client-s3` to `PutObject` /
`DeleteObject` against it. When no target is configured, the client is never
constructed and `enabled` is `false` so the rest of [STORY-0900] short-circuits.

## Files to create / modify

- `package.json` — modify (add `@aws-sdk/client-s3`; optionally `@aws-sdk/lib-storage`)
- `libs/nestjs/src/lib/common/config/env.schema.ts` — modify (add `OPENBUCKET_REPLICATION_*` keys)
- `libs/nestjs/src/lib/common/config/app-config.service.ts` — modify (typed getters)
- `libs/nestjs/src/lib/open-bucket-options.ts` — modify (`replication?` in options + `ResolvedOpenBucketOptions` + `resolveOptions` defaults + validation)
- `libs/nestjs/src/lib/storage/replication/replication-config.ts` — new (`ReplicationConfig` shape + `REPLICATION_CONFIG` token + factory reading either source)
- `libs/nestjs/src/lib/storage/replication/replication-target.service.ts` — new (`S3Client` wrapper)
- `libs/nestjs/src/lib/storage/replication/replication.module.ts` — new (provides config + target service)

## Implementation notes

- `ReplicationConfig` (the single resolved shape both sources produce):
  ```ts
  export interface ReplicationConfig {
    enabled: boolean;
    endpoint?: string;        // https://… (R2/B2/MinIO) — omit for real AWS S3
    region: string;           // default 'us-east-1'
    bucket: string;           // remote target bucket
    accessKeyId: string;
    secretAccessKey: string;
    forcePathStyle: boolean;  // true for MinIO/other-OpenBucket; false for AWS
    maxAttempts: number;      // dead-letter cap, default 12
    drainIntervalMs: number;  // tick interval, default 5000
    batchKeys: number;        // distinct keys drained per tick, default 50
    largeObjectThresholdBytes: number; // switch to lib-storage multipart, default 64 MiB
  }
  ```
- Env (standalone) — add to `EnvSchema`, all optional so absence ⇒ disabled;
  `OPENBUCKET_REPLICATION_ENABLED` gates them and, when true, the endpoint/bucket/creds
  are `.refine`-required together (a partial config must refuse to boot, mirroring
  the `admin`-block footgun guard in `resolveOptions`):
  - `OPENBUCKET_REPLICATION_ENABLED` (bool, default false)
  - `OPENBUCKET_REPLICATION_ENDPOINT` (DNS-safe URL; **warn if `http://`** — see security)
  - `OPENBUCKET_REPLICATION_REGION` (default 'us-east-1')
  - `OPENBUCKET_REPLICATION_BUCKET`
  - `OPENBUCKET_REPLICATION_ACCESS_KEY_ID`, `OPENBUCKET_REPLICATION_SECRET_ACCESS_KEY`
  - `OPENBUCKET_REPLICATION_FORCE_PATH_STYLE` (bool, default true)
  - `OPENBUCKET_REPLICATION_MAX_ATTEMPTS` (int, default 12)
  - `OPENBUCKET_REPLICATION_DRAIN_INTERVAL_MS` (int ≥ 1000, default 5000)
  - `OPENBUCKET_REPLICATION_BATCH_KEYS` (int, default 50)
- Library `OpenBucketModuleOptions.replication?`: same fields (`credentials: { accessKeyId, secretAccessKey }`).
  Extend `ResolvedOpenBucketOptions` and apply defaults in `resolveOptions`. The
  dual-mode `ConfigModule` already chooses env vs options; the
  `REPLICATION_CONFIG` factory reads `AppConfigService` (both sources funnel
  through it) and returns `{ enabled: false }` when unset.
- `ReplicationTargetService`:
  ```ts
  async putObject(input: { key: string; body: Readable; contentLength: number;
    contentType?: string; metadata?: Record<string, string> }): Promise<void>
  async deleteObject(key: string): Promise<void>
  ```
  Build one `S3Client` in the constructor **only when `config.enabled`**
  (`new S3Client({ endpoint, region, forcePathStyle, credentials })`). `putObject`
  issues `PutObjectCommand` with `Body`, `ContentLength`, `ContentType`,
  `Bucket: config.bucket`, `Key: key`. For `contentLength >
  largeObjectThresholdBytes` use `@aws-sdk/lib-storage` `Upload` (multipart) so a
  multi-GB object streams without buffering. `deleteObject` issues
  `DeleteObjectCommand`. Both are plain awaited SDK calls — retry/backoff is the
  **worker's** job ([TASK-2703]), so set the SDK's own `maxAttempts: 1` to avoid
  double retry loops.
- Security / DoS considerations:
  - **Secrets never logged** — do not log the resolved config; add
    `OPENBUCKET_REPLICATION_SECRET_ACCESS_KEY` (and the SDK's `authorization`) to the
    pino `redact` paths pattern established in `open-bucket-core.module.ts`.
    `secretAccessKey` is held only in the `S3Client` credentials closure.
  - **Plaintext transport** — replicated bytes are the object *plaintext*
    (the worker decrypts SSE before sending; see [TASK-2703]), so a plaintext
    `http://` endpoint leaks object contents. Validate the endpoint scheme and
    log a boot-time `warn` for `http://` (do not hard-fail — MinIO on a trusted
    LAN is a legitimate dev case).
  - **SSRF** — the endpoint is operator-supplied config, not request input, so
    this is not a user-driven SSRF sink; still validate it is a well-formed URL to
    fail fast on typos.
  - Validate `bucket` against the S3 bucket-name regex already used in
    `backup.service.ts` so a malformed remote bucket fails at boot, not at drain.

## Acceptance criteria

- [ ] `nx build nestjs` resolves `@aws-sdk/client-s3`; the bundle builds.
- [ ] With replication env unset (or no `replication` option), `REPLICATION_CONFIG`
      resolves `{ enabled: false }` and no `S3Client` is instantiated.
- [ ] A partial standalone config (`ENABLED=true` but missing bucket/creds)
      refuses to boot with a clear message (unit test on the env schema).
- [ ] `ReplicationTargetService.putObject` against a MinIO container writes the
      object with the correct `Content-Type` and byte length ([TEST-0900]).
- [ ] An `http://` endpoint logs a boot-time warning; a malformed endpoint fails validation.

## Test obligations

- Unit: covered by [TEST-0900] (config resolution + partial-config rejection)
- E2E: covered by [TEST-0900] (put/delete against a real S3-compatible container)
- Conformance: N/A

## Dependencies

- Blocked by: [TASK-2700]
