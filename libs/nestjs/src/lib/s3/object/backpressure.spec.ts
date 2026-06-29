import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Readable, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import type { CallHandler, ExecutionContext } from '@nestjs/common';
import type { IncomingMessage } from 'node:http';
import { of } from 'rxjs';

import type { AppConfigService } from '../../common/config/app-config.service';
import { PutObjectInterceptor, PutObjectStreamContext } from './put-object.interceptor';

/**
 * TEST-0316 — backpressure invariants (§4.7). The three streaming hwm sites are
 * pinned at 256 * 1024; a memory probe (gated by OPENBUCKET_MEM_PROBE=1) streams
 * 1 GiB through the verifier and asserts process RSS stays bounded.
 */
const read = (rel: string) => readFileSync(join(__dirname, rel), 'utf8');
const HWM = /256 \* 1024/g;

describe('backpressure invariants (TEST-0316)', () => {
  it('PutObjectInterceptor verifier Transform pins a 256 KB highWaterMark', () => {
    expect(read('put-object.interceptor.ts')).toMatch(HWM);
  });

  it('BlobStore GET read stream and UploadPart write stream pin 256 KB', () => {
    const blob = read('../../storage/blob-store.ts');
    // getBlob's createReadStream + putPart's createWriteStream.
    expect((blob.match(HWM) ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it('forbids req.on("data") in the streaming sources', () => {
    expect(read('put-object.interceptor.ts')).not.toMatch(/req\.on\(\s*['"]data['"]/);
  });

  // Heavy probe: opt-in only. `OPENBUCKET_MEM_PROBE=1 nx test openbucket-backend`.
  const probe = process.env.OPENBUCKET_MEM_PROBE === '1' ? it : it.skip;
  probe(
    'a 1 GiB body streamed through the verifier keeps RSS bounded',
    async () => {
      const interceptor = new PutObjectInterceptor({
        maxObjectSizeMb: 5_120_000,
      } as AppConfigService);

      const TOTAL = 1024 * 1024 * 1024; // 1 GiB
      const CHUNK = Buffer.alloc(256 * 1024, 0x61);
      let remaining = TOTAL;
      const source = new Readable({
        read() {
          if (remaining <= 0) return this.push(null);
          const n = Math.min(CHUNK.length, remaining);
          remaining -= n;
          this.push(n === CHUNK.length ? CHUNK : CHUNK.subarray(0, n));
        },
      });
      const req = source as unknown as IncomingMessage;
      (req as unknown as { headers: unknown }).headers = {
        'x-amz-content-sha256': 'UNSIGNED-PAYLOAD',
      };
      const ctx = {
        switchToHttp: () => ({ getRequest: () => req }),
      } as unknown as ExecutionContext;

      const baseline = process.memoryUsage().rss;
      interceptor.intercept(ctx, { handle: () => of(undefined) } as CallHandler);
      const stream = (req.openbucketPutCtx as PutObjectStreamContext).stream;
      const sink = new Writable({
        highWaterMark: 256 * 1024,
        write(_chunk, _enc, cb) {
          cb();
        },
      });
      await pipeline(stream as Readable, sink);
      const peak = process.memoryUsage().rss;

      // Streaming, not buffering: the delta must be a tiny fraction of 1 GiB.
      expect(peak - baseline).toBeLessThan(256 * 1024 * 1024);
    },
    120_000,
  );
});
