import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

import { ConfigService } from '@nestjs/config';

import type { TransformParams } from '../s3/transforms/transform-params';
import { DerivativeCacheService } from './derivative-cache.service';

/**
 * TEST-0800 — DerivativeCacheService. Drives a real temp DATA_DIR: key
 * stability, atomic put/get round-trip + fan-out layout, single-flight
 * (produce runs once), and miss → null.
 */
function readStreamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on('data', (c: Buffer) => chunks.push(c));
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
  });
}

const PARAMS: TransformParams = {
  width: 200,
  height: 200,
  fit: 'cover',
  format: 'webp',
  quality: 80,
};

describe('DerivativeCacheService (TASK-2401)', () => {
  let dataDir: string;
  let svc: DerivativeCacheService;

  beforeEach(async () => {
    dataDir = join(process.cwd(), 'tmp', `ob-deriv-${randomUUID()}`);
    await fs.mkdir(dataDir, { recursive: true });
    const config = { getOrThrow: () => dataDir } as unknown as ConfigService;
    svc = new DerivativeCacheService(config);
  });

  afterEach(async () => {
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  describe('cacheKey', () => {
    it('is a 64-hex string, stable for identical inputs', () => {
      const a = DerivativeCacheService.cacheKey('etag1', PARAMS);
      const b = DerivativeCacheService.cacheKey('etag1', PARAMS);
      expect(a).toBe(b);
      expect(a).toMatch(/^[0-9a-f]{64}$/);
    });

    it('differs when the source ETag changes', () => {
      expect(DerivativeCacheService.cacheKey('etag1', PARAMS)).not.toBe(
        DerivativeCacheService.cacheKey('etag2', PARAMS),
      );
    });

    it('differs when any param changes', () => {
      const base = DerivativeCacheService.cacheKey('e', PARAMS);
      expect(DerivativeCacheService.cacheKey('e', { ...PARAMS, width: 201 })).not.toBe(base);
      expect(DerivativeCacheService.cacheKey('e', { ...PARAMS, height: 199 })).not.toBe(base);
      expect(DerivativeCacheService.cacheKey('e', { ...PARAMS, fit: 'contain' })).not.toBe(base);
      expect(DerivativeCacheService.cacheKey('e', { ...PARAMS, format: 'png' })).not.toBe(base);
      expect(DerivativeCacheService.cacheKey('e', { ...PARAMS, quality: 79 })).not.toBe(base);
    });
  });

  describe('put + get', () => {
    it('round-trips bytes and lands at derivatives/<h0h1>/<hash>.<ext>', async () => {
      const hash = DerivativeCacheService.cacheKey('etag1', PARAMS);
      const bytes = Buffer.from('transformed-image-bytes');
      await svc.put(hash, 'webp', bytes);

      const expectedPath = join(dataDir, 'derivatives', hash.slice(0, 2), `${hash}.webp`);
      await expect(fs.stat(expectedPath)).resolves.toBeDefined();

      const entry = await svc.get(hash, 'webp');
      expect(entry).not.toBeNull();
      expect(entry!.size).toBe(bytes.length);
      expect(await readStreamToBuffer(entry!.stream)).toEqual(bytes);
    });

    it('leaves no stray tmp file after a put', async () => {
      const hash = DerivativeCacheService.cacheKey('etag1', PARAMS);
      await svc.put(hash, 'webp', Buffer.from('x'));
      const tmp = await fs.readdir(join(dataDir, 'tmp')).catch(() => []);
      expect(tmp).toHaveLength(0);
    });

    it('get on an absent hash returns null (not a throw)', async () => {
      await expect(svc.get('0'.repeat(64), 'webp')).resolves.toBeNull();
    });
  });

  describe('getOrCreate single-flight', () => {
    it('invokes produce exactly once for two concurrent calls on the same hash', async () => {
      const hash = DerivativeCacheService.cacheKey('etag-sf', PARAMS);
      let produced = 0;
      const produce = async (): Promise<Buffer> => {
        produced++;
        await new Promise((r) => setTimeout(r, 20));
        return Buffer.from('single-flight');
      };

      const [a, b] = await Promise.all([
        svc.getOrCreate(hash, 'webp', produce),
        svc.getOrCreate(hash, 'webp', produce),
      ]);

      expect(produced).toBe(1);
      expect(await readStreamToBuffer(a.stream)).toEqual(Buffer.from('single-flight'));
      expect(await readStreamToBuffer(b.stream)).toEqual(Buffer.from('single-flight'));
    });

    it('a warm entry short-circuits produce', async () => {
      const hash = DerivativeCacheService.cacheKey('etag-warm', PARAMS);
      await svc.put(hash, 'webp', Buffer.from('warm'));
      const produce = jest.fn(async () => Buffer.from('cold'));
      const entry = await svc.getOrCreate(hash, 'webp', produce);
      expect(produce).not.toHaveBeenCalled();
      expect(await readStreamToBuffer(entry.stream)).toEqual(Buffer.from('warm'));
    });
  });

  describe('listEntries + evict', () => {
    it('lists written derivatives and evict removes them', async () => {
      const h1 = DerivativeCacheService.cacheKey('e1', PARAMS);
      const h2 = DerivativeCacheService.cacheKey('e2', PARAMS);
      await svc.put(h1, 'webp', Buffer.from('a'));
      await svc.put(h2, 'webp', Buffer.from('bb'));

      const entries = [];
      for await (const e of svc.listEntries()) entries.push(e);
      expect(entries).toHaveLength(2);
      expect(entries.map((e) => e.size).sort()).toEqual([1, 2]);

      await svc.evict(entries[0].path);
      const remaining = [];
      for await (const e of svc.listEntries()) remaining.push(e);
      expect(remaining).toHaveLength(1);
    });

    it('listEntries yields nothing when the store dir is absent', async () => {
      const entries = [];
      for await (const e of svc.listEntries()) entries.push(e);
      expect(entries).toHaveLength(0);
    });
  });
});
