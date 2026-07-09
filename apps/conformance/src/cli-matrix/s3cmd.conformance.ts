import { randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { step } from '../report/recorder';
import { CREDS, run, startOpenbucket, type RunningOpenbucket } from './support';

/**
 * TEST-0502 case 4 (TASK-1544) — s3cmd row of the conformance matrix: write a temp
 * `.s3cfg` pointing at the mapped port (path-style, plain HTTP), then mb / put /
 * get / del. Needs a Docker daemon, the image, and `s3cmd` on PATH.
 */
describe('conformance: s3cmd matrix', () => {
  let ob: RunningOpenbucket;
  let dir: string;
  let src: string;
  let dst: string;
  let cfg: string;

  beforeAll(async () => {
    ob = await startOpenbucket();
    dir = mkdtempSync(join(tmpdir(), 'ob-s3cmd-'));
    src = join(dir, 'src.bin');
    dst = join(dir, 'dst.bin');
    cfg = join(dir, 's3cfg');
    writeFileSync(src, randomBytes(1024 * 1024));
    // host_bucket == host_base (no {bucket}. prefix) forces path-style addressing.
    writeFileSync(
      cfg,
      [
        '[default]',
        `host_base = ${ob.host}:${ob.port}`,
        `host_bucket = ${ob.host}:${ob.port}`,
        'use_https = False',
        `access_key = ${CREDS.accessKeyId}`,
        `secret_key = ${CREDS.secretAccessKey}`,
        'signature_v2 = False',
        '',
      ].join('\n'),
    );
  }, 90_000);

  afterAll(async () => {
    await ob?.container.stop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it('mb, put, get (byte-equal), del', async () => {
    const c = ['-c', cfg];
    const uri = 's3://s3cmd-conf/blob.bin';

    await step('s3cmd', 'CreateBucket', () => run('s3cmd', [...c, 'mb', 's3://s3cmd-conf']));
    await step('s3cmd', 'PutObject', () => run('s3cmd', [...c, 'put', src, uri]));

    await step('s3cmd', 'GetObject', async () => {
      await run('s3cmd', [...c, 'get', '--force', uri, dst]);
      expect(readFileSync(dst).equals(readFileSync(src))).toBe(true);
    });

    await step('s3cmd', 'DeleteObject', () => run('s3cmd', [...c, 'del', uri]));
  });
});
