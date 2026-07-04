import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Readable, Writable } from 'node:stream';
import sharp from 'sharp';

import { ConfigService } from '@nestjs/config';

import type { AppConfigService } from '../../common/config/app-config.service';
import type { ObjectService } from '../../domain/objects/object.service';
import { DerivativeCacheService } from '../../storage/derivative-cache.service';
import { InvalidArgumentError, NoSuchKeyError } from '../errors/s3-error';
import { ImageTransformService } from './image-transform.service';

/**
 * TEST-0800 — ImageTransformService. Drives the real sharp pipeline + a real
 * temp-dir DerivativeCacheService with stubbed ObjectService/config. Asserts:
 * pipeline output, cache hit (produce-once), passthrough for non-image/SVG,
 * DoS bounds (input-byte cap + limitInputPixels → 400), 304, and the
 * feature kill-switch.
 */

/** Minimal Express Response double: a Writable that captures headers + body. */
class FakeRes extends Writable {
  statusCode = 200;
  headers: Record<string, string | number> = {};
  headersSent = false;
  delegated = false;
  private chunks: Buffer[] = [];
  finished: Promise<void>;

  constructor() {
    super();
    this.finished = new Promise((resolve) => this.on('finish', () => resolve()));
  }
  override _write(chunk: Buffer, _enc: string, cb: () => void): void {
    this.headersSent = true;
    this.chunks.push(Buffer.from(chunk));
    cb();
  }
  setHeader(k: string, v: string | number): void {
    this.headers[k.toLowerCase()] = v;
  }
  getHeader(k: string): string | number | undefined {
    return this.headers[k.toLowerCase()];
  }
  status(code: number): this {
    this.statusCode = code;
    return this;
  }
  body(): Buffer {
    return Buffer.concat(this.chunks);
  }
}

const fakeReq = (query: Record<string, unknown>, headers: Record<string, string> = {}) =>
  ({ query, headers, socket: { destroy: () => undefined } }) as unknown as import('express').Request;

/** Cast a FakeRes to the Express Response the service signature expects. */
const asRes = (r: FakeRes): import('express').Response => r as unknown as import('express').Response;

async function jpeg(width: number, height: number): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 3, background: { r: 200, g: 40, b: 40 } },
  })
    .jpeg()
    .toBuffer();
}

describe('ImageTransformService (TASK-2402)', () => {
  let dataDir: string;
  let cache: DerivativeCacheService;
  let img: Buffer;

  const makeConfig = (over: Partial<Record<string, unknown>> = {}): AppConfigService =>
    ({
      imageTransformEnabled: true,
      maxTransformDimension: 4096,
      maxTransformInputBytes: 50 * 1024 * 1024,
      transformLimitInputPixels: 24_000 * 24_000,
      imageTransformConcurrency: 2,
      ...over,
    }) as unknown as AppConfigService;

  const makeObjects = (
    src: {
      contentType?: string;
      etag?: string;
      size?: number;
      body?: Buffer;
    } | null,
  ): { objects: ObjectService; getObject: jest.Mock; openObjectStream: jest.Mock } => {
    const getObject = jest.fn(async (_req, res: FakeRes) => {
      res.delegated = true;
      res.status(200);
      res.end();
      return undefined;
    });
    const openObjectStream = jest.fn(async () =>
      src === null
        ? null
        : {
            stream: Readable.from(src.body ?? img),
            size: src.size ?? (src.body ?? img).length,
            contentType: src.contentType ?? 'image/jpeg',
            etag: src.etag ?? 'etag-1',
            lastModified: new Date(),
          },
    );
    return { objects: { getObject, openObjectStream } as unknown as ObjectService, getObject, openObjectStream };
  };

  beforeEach(async () => {
    dataDir = join(process.cwd(), 'tmp', `ob-xform-${randomUUID()}`);
    await fs.mkdir(dataDir, { recursive: true });
    cache = new DerivativeCacheService({ getOrThrow: () => dataDir } as unknown as ConfigService);
    img = await jpeg(400, 300);
  });

  afterEach(async () => {
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  describe('isCandidate', () => {
    it('is true for a transform request when enabled', () => {
      const svc = new ImageTransformService(makeObjects({}).objects, cache, makeConfig());
      expect(svc.isCandidate({ w: '200' })).toBe(true);
      expect(svc.isCandidate({ tagging: '' })).toBe(false);
      expect(svc.isCandidate({})).toBe(false);
    });

    it('is false when the feature is disabled (kill-switch)', () => {
      const svc = new ImageTransformService(
        makeObjects({}).objects,
        cache,
        makeConfig({ imageTransformEnabled: false }),
      );
      expect(svc.isCandidate({ w: '200' })).toBe(false);
    });
  });

  it('transforms jpeg → 200x200 webp with a 64-hex ETag and immutable caching', async () => {
    const { objects } = makeObjects({ contentType: 'image/jpeg', etag: 'etag-1' });
    const svc = new ImageTransformService(objects, cache, makeConfig());
    const res = new FakeRes();

    await svc.get(fakeReq({ w: '200', h: '200', fit: 'cover', format: 'webp' }), asRes(res), 'b', 'cat.jpg');
    await res.finished;

    expect(res.statusCode).toBe(200);
    expect(res.getHeader('content-type')).toBe('image/webp');
    expect(res.getHeader('cache-control')).toBe('public, max-age=31536000, immutable');
    expect(res.getHeader('accept-ranges')).toBe('none');
    expect(res.getHeader('x-content-type-options')).toBe('nosniff');
    expect(String(res.getHeader('etag'))).toMatch(/^"[0-9a-f]{64}"$/);

    const meta = await sharp(res.body()).metadata();
    expect(meta.format).toBe('webp');
    expect(meta.width).toBe(200);
    expect(meta.height).toBe(200);
  });

  it('a second identical request is a cache hit (produce runs once, byte-identical)', async () => {
    const { objects } = makeObjects({ contentType: 'image/jpeg', etag: 'etag-1' });
    const svc = new ImageTransformService(objects, cache, makeConfig());
    const putSpy = jest.spyOn(cache, 'put');

    const res1 = new FakeRes();
    await svc.get(fakeReq({ w: '150', format: 'webp' }), asRes(res1), 'b', 'cat.jpg');
    await res1.finished;

    const res2 = new FakeRes();
    await svc.get(fakeReq({ w: '150', format: 'webp' }), asRes(res2), 'b', 'cat.jpg');
    await res2.finished;

    expect(putSpy).toHaveBeenCalledTimes(1); // produced once, second was a hit
    expect(res2.body()).toEqual(res1.body());
    expect(res2.getHeader('etag')).toBe(res1.getHeader('etag'));
  });

  it('passthrough: an SVG source with ?w= is served by the normal getObject (not transformed)', async () => {
    const { objects, getObject } = makeObjects({ contentType: 'image/svg+xml' });
    const svc = new ImageTransformService(objects, cache, makeConfig());
    const res = new FakeRes();
    await svc.get(fakeReq({ w: '100' }), asRes(res), 'b', 'logo.svg');
    expect(getObject).toHaveBeenCalledTimes(1);
    expect(res.delegated).toBe(true);
  });

  it('passthrough: a non-image source with ?w= is served by the normal getObject', async () => {
    const { objects, getObject } = makeObjects({ contentType: 'application/pdf' });
    const svc = new ImageTransformService(objects, cache, makeConfig());
    const res = new FakeRes();
    await svc.get(fakeReq({ w: '100' }), asRes(res), 'b', 'doc.pdf');
    expect(getObject).toHaveBeenCalledTimes(1);
    expect(res.delegated).toBe(true);
  });

  it('missing source → NoSuchKeyError', async () => {
    const { objects } = makeObjects(null);
    const svc = new ImageTransformService(objects, cache, makeConfig());
    await expect(svc.get(fakeReq({ w: '100' }), asRes(new FakeRes()), 'b', 'gone.jpg')).rejects.toBeInstanceOf(
      NoSuchKeyError,
    );
  });

  it('bad params → 400 InvalidArgument (not 500)', async () => {
    const { objects } = makeObjects({ contentType: 'image/jpeg' });
    const svc = new ImageTransformService(objects, cache, makeConfig());
    await expect(
      svc.get(fakeReq({ w: '999999' }), asRes(new FakeRes()), 'b', 'cat.jpg'),
    ).rejects.toBeInstanceOf(InvalidArgumentError);
  });

  it('source over maxTransformInputBytes → 400 (before buffering)', async () => {
    const { objects } = makeObjects({ contentType: 'image/jpeg', size: 10_000_000 });
    const svc = new ImageTransformService(
      objects,
      cache,
      makeConfig({ maxTransformInputBytes: 1024 }),
    );
    await expect(
      svc.get(fakeReq({ w: '100' }), asRes(new FakeRes()), 'b', 'huge.jpg'),
    ).rejects.toBeInstanceOf(InvalidArgumentError);
  });

  it('a decode past transformLimitInputPixels → 400, not 500/OOM', async () => {
    const { objects } = makeObjects({ contentType: 'image/jpeg' }); // 400x300 = 120k px
    const svc = new ImageTransformService(
      objects,
      cache,
      makeConfig({ transformLimitInputPixels: 100 }), // any real image blows this
    );
    await expect(
      svc.get(fakeReq({ w: '50', format: 'webp' }), asRes(new FakeRes()), 'b', 'bomb.jpg'),
    ).rejects.toBeInstanceOf(InvalidArgumentError);
  });

  it('honours If-None-Match against the derivative ETag → 304', async () => {
    const { objects } = makeObjects({ contentType: 'image/jpeg', etag: 'etag-1' });
    const svc = new ImageTransformService(objects, cache, makeConfig());

    const first = new FakeRes();
    await svc.get(fakeReq({ w: '120', format: 'webp' }), asRes(first), 'b', 'cat.jpg');
    await first.finished;
    const etag = String(first.getHeader('etag'));

    const res = new FakeRes();
    await svc.get(
      fakeReq({ w: '120', format: 'webp' }, { 'if-none-match': etag }),
      asRes(res),
      'b',
      'cat.jpg',
    );
    await res.finished;
    expect(res.statusCode).toBe(304);
    expect(res.body()).toHaveLength(0);
    expect(res.getHeader('etag')).toBe(etag);
  });

  it('format omitted → re-encodes in the native format at the requested size', async () => {
    const { objects } = makeObjects({ contentType: 'image/png', etag: 'e-png', body: await sharp({ create: { width: 300, height: 200, channels: 3, background: { r: 1, g: 2, b: 3 } } }).png().toBuffer() });
    const svc = new ImageTransformService(objects, cache, makeConfig());
    const res = new FakeRes();
    await svc.get(fakeReq({ w: '100' }), asRes(res), 'b', 'pic.png');
    await res.finished;
    expect(res.getHeader('content-type')).toBe('image/png');
    const meta = await sharp(res.body()).metadata();
    expect(meta.format).toBe('png');
    expect(meta.width).toBe(100);
  });
});
