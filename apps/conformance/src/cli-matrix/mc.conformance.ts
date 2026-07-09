import { randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { step } from '../report/recorder';
import { CREDS, run, runBinary, startOpenbucket, type RunningOpenbucket } from './support';

/**
 * TEST-0502 case 3 (TASK-1543) — mc row of the conformance matrix: configure an
 * `mc` alias against the booted image, then mb / cp / cat / rm. Needs a Docker
 * daemon, the image, and `mc` on PATH.
 *
 * `mc cp` uploads with `x-amz-content-sha256: STREAMING-AWS4-HMAC-SHA256-PAYLOAD`
 * (chunked-upload signing), supported as of [STORY-0119].
 */
describe('conformance: mc matrix', () => {
  let ob: RunningOpenbucket;
  let dir: string;
  let src: string;
  const alias = 'obconf';

  beforeAll(async () => {
    ob = await startOpenbucket();
    dir = mkdtempSync(join(tmpdir(), 'ob-mc-'));
    src = join(dir, 'src.bin');
    writeFileSync(src, randomBytes(1024 * 1024));
    await run('mc', [
      'alias',
      'set',
      alias,
      ob.endpoint,
      CREDS.accessKeyId,
      CREDS.secretAccessKey,
      '--api',
      'S3v4',
    ]);
  }, 90_000);

  afterAll(async () => {
    await run('mc', ['alias', 'rm', alias]).catch(() => undefined);
    await ob?.container.stop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it('mb, cp, cat (byte-equal), rm', async () => {
    const target = `${alias}/mc-conf/blob.bin`;

    await step('mc', 'CreateBucket', () => run('mc', ['mb', `${alias}/mc-conf`]));
    await step('mc', 'PutObject', () => run('mc', ['cp', src, target]));

    await step('mc', 'GetObject', async () => {
      const downloaded = await runBinary('mc', ['cat', target]);
      expect(downloaded.equals(readFileSync(src))).toBe(true);
    });

    await step('mc', 'DeleteObject', () => run('mc', ['rm', target]));
  });
});
