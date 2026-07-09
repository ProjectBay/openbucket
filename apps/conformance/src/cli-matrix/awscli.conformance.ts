import { randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { step } from '../report/recorder';
import { CREDS, run, startOpenbucket, type RunningOpenbucket } from './support';

/**
 * TEST-0502 case 2 (TASK-1542) — aws-cli row of the conformance matrix: shell out
 * to `aws` against the booted image and round-trip a 1 MiB object. Needs a Docker
 * daemon, the `openbucket:local` image (or OPENBUCKET_IMAGE), and `aws` on PATH.
 */
describe('conformance: aws-cli matrix', () => {
  let ob: RunningOpenbucket;
  let dir: string;
  let src: string;
  let dst: string;
  const env: NodeJS.ProcessEnv = {
    AWS_ACCESS_KEY_ID: CREDS.accessKeyId,
    AWS_SECRET_ACCESS_KEY: CREDS.secretAccessKey,
    AWS_DEFAULT_REGION: 'us-east-1',
    AWS_EC2_METADATA_DISABLED: 'true',
  };

  beforeAll(async () => {
    ob = await startOpenbucket();
    dir = mkdtempSync(join(tmpdir(), 'ob-awscli-'));
    src = join(dir, 'src.bin');
    dst = join(dir, 'dst.bin');
    writeFileSync(src, randomBytes(1024 * 1024));
  }, 90_000);

  afterAll(async () => {
    await ob?.container.stop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it('create-bucket, cp (put + get, byte-equal), rm', async () => {
    const bucket = 'awscli-conf';
    const ep = ['--endpoint-url', ob.endpoint];

    await step('aws-cli', 'CreateBucket', () =>
      run('aws', [...ep, 's3api', 'create-bucket', '--bucket', bucket], env),
    );
    await step('aws-cli', 'PutObject', () =>
      run('aws', [...ep, 's3', 'cp', src, `s3://${bucket}/blob.bin`], env),
    );
    await step('aws-cli', 'GetObject', async () => {
      await run('aws', [...ep, 's3', 'cp', `s3://${bucket}/blob.bin`, dst], env);
      expect(readFileSync(dst).equals(readFileSync(src))).toBe(true);
    });

    await step('aws-cli', 'DeleteObject', () =>
      run('aws', [...ep, 's3', 'rm', `s3://${bucket}/blob.bin`], env),
    );
  });
});
