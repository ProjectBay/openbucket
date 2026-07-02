import { randomBytes } from 'node:crypto';

import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { GenericContainer, StartedTestContainer, Wait } from 'testcontainers';

/**
 * TEST-0503 / §5.20.3 — canonical SDK conformance sample: boot the built image
 * via testcontainers, point @aws-sdk/client-s3 at it, and round-trip a 4 MiB
 * object. Other Epics' conformance Test Plans copy this fixture shape.
 *
 * Requires a running Docker daemon and the `openbucket:local` image (or set
 * OPENBUCKET_IMAGE). The CLI matrix (aws-cli/mc/s3cmd) is STORY-0504.
 */
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
        // Required by the refuse-to-boot config schema (argon2id format).
        ADMIN_PASSWORD_HASH: '$argon2id$v=19$m=65536,t=3,p=4$abc$def',
      })
      .withWaitStrategy(Wait.forHttp('/api/admin/health', 9000).forStatusCode(200))
      .withStartupTimeout(60_000)
      .start();

    s3 = new S3Client({
      endpoint: `http://${container.getHost()}:${container.getMappedPort(9000)}`,
      region: 'us-east-1',
      forcePathStyle: true,
      // AWS SDK v3 (>=~3.650) adds a default CRC32 to every request and loads the
      // crc32 module via a dynamic import() on the first send() — which Jest's VM
      // rejects (ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING_FLAG) unless run with
      // --experimental-vm-modules. Checksums are optional in S3, so opt out to
      // keep this suite runnable under Jest without the Node flag.
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
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

    const put = await s3.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body }));
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
