---
id: TASK-1541
title: Author the AWS-SDK object-roundtrip sample
story: STORY-0504
status: review
type: implementation
size: S
---

## Description
Land `apps/conformance/src/object-roundtrip.conformance.ts`, the canonical conformance test pattern: boots the OpenBucket image via `testcontainers`, configures `@aws-sdk/client-s3` with `forcePathStyle: true` against the mapped port, and PUTs / GETs / DELETEs a 4 MiB random payload asserting on ETag parity.

## Files to create / modify
- `apps/conformance/src/object-roundtrip.conformance.ts` — new

## Implementation notes
- Verbatim sample from white paper §5.20.3:

  ```ts
  // apps/conformance/src/object-roundtrip.conformance.ts
  import { GenericContainer, StartedTestContainer, Wait } from 'testcontainers';
  import {
    S3Client, CreateBucketCommand, PutObjectCommand, GetObjectCommand, DeleteObjectCommand,
  } from '@aws-sdk/client-s3';
  import { randomBytes } from 'node:crypto';

  describe('conformance: object roundtrip', () => {
    let container: StartedTestContainer;
    let s3: S3Client;

    beforeAll(async () => {
      container = await new GenericContainer(process.env.OPENBUCKET_IMAGE ?? 'openbucket:local')
        .withExposedPorts(9000)
        .withEnvironment({
          DATA_DIR: '/data',
          JWT_SECRET: 'conformance-secret-conformance-secret',
          ROOT_ACCESS_KEY_ID: 'AKIAIOSFODNN7EXAMPLE',
          ROOT_SECRET_ACCESS_KEY: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
        })
        .withWaitStrategy(Wait.forHttp('/api/admin/health', 9000).forStatusCode(200))
        .withStartupTimeout(60_000)
        .start();

      s3 = new S3Client({
        endpoint: `http://${container.getHost()}:${container.getMappedPort(9000)}`,
        region: 'us-east-1',
        forcePathStyle: true,
        credentials: {
          accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
          secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
        },
      });
    }, 90_000);

    afterAll(async () => {
      await container?.stop();
    });

    it('puts, gets, and deletes a 4 MiB object with matching ETag', async () => {
      const bucket = 'roundtrip';
      const key = 'fixtures/blob.bin';
      const body = randomBytes(4 * 1024 * 1024);

      await s3.send(new CreateBucketCommand({ Bucket: bucket }));

      const put = await s3.send(new PutObjectCommand({
        Bucket: bucket, Key: key, Body: body,
      }));
      expect(put.ETag).toMatch(/^"[0-9a-f]{32}"$/);

      const get = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
      const downloaded = Buffer.concat(await collect(get.Body as AsyncIterable<Uint8Array>));
      expect(downloaded.equals(body)).toBe(true);
      expect(get.ETag).toBe(put.ETag);

      await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    });
  });

  async function collect(stream: AsyncIterable<Uint8Array>): Promise<Buffer[]> {
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk));
    return chunks;
  }
  ```

- `OPENBUCKET_IMAGE` env defaults to `openbucket:local` so local runs work; CI sets it to the just-built tag (§5.19).
- The sentinel access keys (`AKIAIOSFODNN7EXAMPLE` / `wJalrXUtnFEMI/...`) are AWS's own published examples — safe to keep as fixed credentials.

## Acceptance criteria
- [ ] The file exists and is byte-equal to the white-paper sample.
- [ ] `nx run conformance:e2e --testPathPattern=object-roundtrip` passes locally against a `docker build -t openbucket:local .` image.
- [ ] ETag assertion `^"[0-9a-f]{32}"$` holds (single-PUT MD5-hex ETag with surrounding quotes).

## Test obligations
- Unit: N/A.
- E2E: N/A.
- Conformance: this *is* the conformance sample; covered by [TEST-0502] and (as a template) by [TEST-0503].

## Dependencies
- Blocked by: [TASK-1540], [STORY-0501]

## References
- `docs/WHITEPAPER.md` §5.20.3 (lines 8875–8946)
