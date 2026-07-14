---
slug: stop-mocking-s3-in-integration-tests
title: 'Stop mocking S3: real object storage in your integration tests'
description: Mocking the S3 client tests your mocks, not your code. Boot a real S3-compatible store in-process in Jest — or in a testcontainer — with zero infra.
authors: [openbucket]
tags: [testing, jest, s3, nestjs, testcontainers, ci]
date: 2026-09-16
draft: true
keywords:
  [
    mock s3 jest,
    s3 integration testing nodejs,
    localstack alternative,
    testcontainers s3,
    nestjs testing file upload,
    jest s3 integration test,
  ]
---

If your test suite stubs out `S3Client`, here's an uncomfortable question: what
exactly is it testing? A mocked `send()` happily accepts a presigned URL that
would never verify, a content type that would never survive a round-trip, and a
multipart upload sequence that no real S3 implementation would accept. The mock
asserts that you *called* S3 the way you expected to — not that S3 would have
said yes.

The usual fix is to run something real in CI — LocalStack, MinIO — and eat the
infra cost. OpenBucket offers a cheaper path: it's an S3-compatible object store
that ships as an npm package, so in a Node/NestJS project you can boot the
**real wire protocol inside your Jest process**. No container, no AWS account,
no network. This post shows both flavors: in-process for Nest apps, and a
testcontainer for everything else.

<!-- truncate -->

## What mocks can't catch

These are the failure modes that only surface against a real implementation:

- **Signatures.** SigV4 signing (headers *and* presigned query strings) depends
  on the exact canonical request. A mock never verifies a signature; a real
  server rejects a subtly wrong one with `403 SignatureDoesNotMatch`.
- **Content types and metadata.** Does `ContentType` actually round-trip? Do
  your `x-amz-meta-*` headers come back on GET? A mock returns whatever you
  told it to return.
- **Multipart uploads.** Part ordering, minimum part sizes, complete/abort
  semantics — an entire state machine that a stub reduces to "resolves".
- **Error envelopes.** Real S3 errors are XML with a `<Code>` that the SDK maps
  to an error name like `NoSuchKey`. If your retry/fallback logic branches on
  those names, a mocked rejection proves nothing.

Unit tests with a mocked client are still fine for pure business logic. But the
storage *integration* — the part that actually breaks in production — needs a
real implementation on the other side of the socket.

## Flavor 1: in-process, for NestJS apps

`@openbucket/nestjs` is a Nest module, so it boots inside
`Test.createTestingModule` like any other module — the same way OpenBucket's
own wire-level specs run. Omitting the `admin` block gives you a headless,
S3-only store: no admin API, no JWT setup, nothing to configure but a data
directory and credentials.

```bash
npm install --save-dev @aws-sdk/client-s3
npm install @openbucket/nestjs
```

The spec below boots the store on a random port, points the standard AWS SDK at
it, and exercises the three things mocks can't: a signed round-trip, a
presigned URL fetched with plain `fetch`, and a real error envelope.

```ts title="s3-storage.integration.spec.ts"
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { OpenBucketModule, OpenBucketService } from '@openbucket/nestjs';
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { mkdtempSync, rmSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CREDS = {
  accessKeyId: 'AKIATESTONLY00000000',
  secretAccessKey: 'test-only-secret-test-only-secret-40ch',
};

describe('object storage (real S3, in-process)', () => {
  let app: INestApplication;
  let ob: OpenBucketService;
  let s3: S3Client;
  let dataDir: string;
  let origin: string;

  beforeAll(async () => {
    // A fresh temp dir per suite keeps parallel Jest workers isolated.
    dataDir = mkdtempSync(join(tmpdir(), 'ob-spec-'));

    const moduleRef = await Test.createTestingModule({
      imports: [
        OpenBucketModule.forRoot({
          dataDir,
          mountPath: '/s3',
          rootCredentials: CREDS,
          // no `admin` block → headless S3-only store, ideal for tests
        }),
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
    await app.listen(0); // any free port
    const { port } = app.getHttpServer().address() as AddressInfo;
    origin = `http://127.0.0.1:${port}`;

    ob = app.get(OpenBucketService);
    await ob.createBucket('uploads');

    s3 = new S3Client({
      endpoint: `${origin}/s3`, // host + mountPath
      region: 'us-east-1',
      forcePathStyle: true, // required — path-style addressing
      credentials: CREDS,
    });
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('round-trips an object over the wire, content type intact', async () => {
    await s3.send(
      new PutObjectCommand({
        Bucket: 'uploads',
        Key: 'hello.txt',
        Body: 'hello world',
        ContentType: 'text/plain',
      }),
    );
    const got = await s3.send(new GetObjectCommand({ Bucket: 'uploads', Key: 'hello.txt' }));
    expect(await got.Body!.transformToString()).toBe('hello world');
    expect(got.ContentType).toBe('text/plain');
  });

  it('mints a presigned GET URL that a plain fetch can use', async () => {
    const url = ob.presignGetUrl('uploads', 'hello.txt', {
      baseUrl: origin, // scheme + host; the mountPath is appended for you
      expiresIn: 60,
    });
    const res = await fetch(url); // unauthenticated client — the signature does the work
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('hello world');
  });

  it('returns a real S3 error envelope for a missing key', async () => {
    await expect(
      s3.send(new GetObjectCommand({ Bucket: 'uploads', Key: 'does-not-exist' })),
    ).rejects.toMatchObject({ name: 'NoSuchKey' });
  });
});
```

Everything here is real: the SDK signs each request with SigV4 and the server
verifies it; the presigned URL is checked cryptographically; the `NoSuchKey`
error name comes from an actual XML error body the SDK parsed. Flip one
character in the secret key and the suite fails with `403` — try doing *that*
with a mock.

Two practical notes. First, if your app uses the
[`@openbucket/nestjs/multer` upload interceptor](/docs/guides/file-uploads),
import your real `AppModule` (or feature module) instead of registering
`OpenBucketModule` directly, and drive the endpoint with `supertest` — you're
then testing your actual upload pipeline, validation included. Second, metadata
lives in SQLite and blobs on disk under `dataDir`, so the `mkdtempSync` +
`rmSync` pair above is the entire setup/teardown story.

## Flavor 2: a testcontainer, for everything else

Not on Nest? Polyglot stack? OpenBucket also ships as a Docker image, and this
is exactly how the project tests itself: the S3 conformance suite boots the
image with [testcontainers](https://testcontainers.com/) and points
`@aws-sdk/client-s3` at the mapped port. Adapted for a published image:

```ts title="s3.container-setup.ts"
import { GenericContainer, StartedTestContainer, Wait } from 'testcontainers';

export async function startOpenBucket(): Promise<StartedTestContainer> {
  return new GenericContainer('ghcr.io/projectbay/openbucket:0.1.0-alpha.20')
    .withExposedPorts(9000)
    .withEnvironment({
      DATA_DIR: '/data',
      JWT_SECRET: 'test-only-jwt-secret-test-only-jwt-secret',
      ROOT_ACCESS_KEY_ID: 'AKIATESTONLY00000000',
      ROOT_SECRET_ACCESS_KEY: 'test-only-secret-test-only-secret-40ch',
      // Required by the refuse-to-boot config schema (argon2id format);
      // a dummy is fine — tests never log in to the admin API.
      ADMIN_PASSWORD_HASH: '$argon2id$v=19$m=65536,t=3,p=4$abc$def',
    })
    .withWaitStrategy(Wait.forHttp('/api/admin/health', 9000).forStatusCode(200))
    .withStartupTimeout(60_000)
    .start();
}
```

Then construct the client from the mapped port:

```ts title="s3.client.ts"
const endpoint = `http://${container.getHost()}:${container.getMappedPort(9000)}`;
const s3 = new S3Client({
  endpoint,
  region: 'us-east-1',
  forcePathStyle: true,
  credentials: {
    accessKeyId: 'AKIATESTONLY00000000',
    secretAccessKey: 'test-only-secret-test-only-secret-40ch',
  },
});
```

The image is small (one Node process, SQLite inside), boots to a healthy state
in seconds, and needs no volumes for throwaway test data. Testcontainers has
bindings for Java, Go, Python, .NET and more, so the same recipe works outside
TypeScript.

## What this means for CI

- **No external service, no credentials.** Nothing to provision, no AWS
  account, no secrets to rotate. The keys in your specs are throwaway strings.
- **The in-process flavor doesn't even need Docker.** It's just Jest, so it
  runs on any CI runner — and offline on the train.
- **Deterministic isolation.** A temp `dataDir` per suite means no shared state
  between workers and no cleanup jobs against a long-lived test bucket.

## An honest comparison

- **LocalStack** emulates a large slice of AWS. If your tests touch SQS, Lambda
  *and* S3, it's the right tool. If you only need S3, you're running a hefty
  container to get one API.
- **Client mocks** (e.g. `aws-sdk-client-mock`) remain great for unit-testing
  logic *around* storage. The argument here isn't "never mock" — it's that the
  integration seam deserves a real implementation.
- **MinIO in CI** gives you real S3 semantics too, and it scales far beyond
  what OpenBucket targets. But it's always a separate process — there's no
  in-process option for a Node test suite. (More in
  [OpenBucket vs MinIO](/docs/comparisons/vs-minio).)

And the honest caveat on our side: OpenBucket is pre-1.0 and deliberately
single-node. Its S3 surface is broad — SigV4, presigned URLs, multipart,
versioning, object lock, lifecycle, CORS, bucket policies — but it is not a
byte-for-byte AWS clone. Check the
[S3 compatibility matrix](/docs/reference/s3-compatibility) before you rely on
an operation, and if production for you means real AWS S3, treat these tests as
what they are: high-fidelity, not identical.

## Where to go next

- Embedding the module properly, `forRootAsync` and all →
  [quickstart: embed in NestJS](/docs/getting-started/quickstart-embed)
- The full `OpenBucketService` API you can call from specs →
  [service reference](/docs/reference/openbucket-service)
- Whether OpenBucket fits beyond the test suite →
  [Is OpenBucket for you?](/docs/is-openbucket-for-you)

---

If you rip a mock out of your suite this week and something real breaks — that's
the feature. Tell us about it in
[Discussions](https://github.com/ProjectBay/openbucket/discussions), and if the
in-process trick earns a place in your toolbox, a star on
[GitHub](https://github.com/ProjectBay/openbucket) helps the next person who's
still stubbing `send()`.
