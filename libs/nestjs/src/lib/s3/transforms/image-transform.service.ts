import { Injectable, Logger } from '@nestjs/common';
import type { Request, Response } from 'express';
import type { Readable } from 'node:stream';
import sharp from 'sharp';

import { AppConfigService } from '../../common/config/app-config.service';
import { ObjectService } from '../../domain/objects/object.service';
import { DerivativeCacheService } from '../../storage/derivative-cache.service';
import { InvalidArgumentError, NoSuchKeyError } from '../errors/s3-error';
import {
  FORMAT_MIME,
  isTransformableContentType,
  isTransformRequest,
  parseTransformParams,
  type OutputFormat,
  type TransformParams,
} from './transform-params';

/**
 * How each transformable source type re-encodes when the request omits an
 * explicit `format` (native re-encode at the requested size). Maps to the sharp
 * output format, the cache-file extension, and the response MIME.
 */
const NATIVE_OUTPUT: Record<string, { sharpFormat: keyof sharp.FormatEnum; ext: string; mime: string }> = {
  'image/jpeg': { sharpFormat: 'jpeg', ext: 'jpg', mime: 'image/jpeg' },
  'image/png': { sharpFormat: 'png', ext: 'png', mime: 'image/png' },
  'image/webp': { sharpFormat: 'webp', ext: 'webp', mime: 'image/webp' },
  'image/avif': { sharpFormat: 'avif', ext: 'avif', mime: 'image/avif' },
  'image/gif': { sharpFormat: 'gif', ext: 'gif', mime: 'image/gif' },
  'image/tiff': { sharpFormat: 'tiff', ext: 'tiff', mime: 'image/tiff' },
};

/**
 * A tiny counting semaphore. sharp decodes are CPU+RAM heavy, so unbounded
 * parallelism is the real transform-bomb DoS; this caps in-flight transforms at
 * `IMAGE_TRANSFORM_CONCURRENCY` and queues the rest.
 */
class CountingSemaphore {
  private active = 0;
  private readonly queue: Array<() => void> = [];
  constructor(private readonly max: number) {}

  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }

  private acquire(): Promise<void> {
    if (this.active < this.max) {
      this.active++;
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => this.queue.push(resolve));
  }

  private release(): void {
    const next = this.queue.shift();
    if (next) {
      // Hand the slot straight to the next waiter (active count unchanged).
      next();
    } else {
      this.active--;
    }
  }
}

/**
 * On-the-fly image transform pipeline (STORY-0800). Intercepts a transform GET
 * before the plain `getObject` path: resolves the decrypted source, resizes /
 * re-encodes it with sharp under strict resource bounds, and serves the result
 * via the content-addressed {@link DerivativeCacheService}. Everything that is
 * not an allow-listed raster image (or that carries no transform params) falls
 * straight through to the normal, header-neutralized GET.
 *
 * DoS posture (defence in depth): the param parser bounds the output canvas
 * before decode; an input-byte cap refuses oversized sources pre-buffer;
 * sharp's `limitInputPixels` turns a decompression bomb into a 400; a counting
 * semaphore caps concurrent decodes; single-flight collapses a cold-cache herd;
 * and the per-IP `S3_THROTTLE` bucket sits in front of all of it.
 *
 * Authz is unchanged: the request has already passed `SigV4Guard` +
 * `PolicyAuthorizationGuard` for `s3:GetObject` (the op resolver returns
 * `GetObject` for these params); this runs inside the guarded handler, so there
 * is no new authorization path.
 */
@Injectable()
export class ImageTransformService {
  private readonly log = new Logger(ImageTransformService.name);
  private readonly semaphore: CountingSemaphore;

  constructor(
    private readonly objects: ObjectService,
    private readonly cache: DerivativeCacheService,
    private readonly config: AppConfigService,
  ) {
    this.semaphore = new CountingSemaphore(config.imageTransformConcurrency);
  }

  /**
   * Should the GET dispatcher hand this request to the transform path? Only when
   * the feature is enabled AND the query is a transform request (delegates to
   * {@link isTransformRequest}, so sub-resource / version GETs are excluded).
   */
  isCandidate(q: Record<string, unknown>): boolean {
    return this.config.imageTransformEnabled && isTransformRequest(q);
  }

  /**
   * Serve a transform GET. Writes the response directly (the object GET route is
   * in library-specific mode), returning `undefined` so the XmlInterceptor
   * passes through. Non-image / SVG sources are delegated to the plain GET.
   */
  async get(req: Request, res: Response, bucket: string, key: string): Promise<undefined> {
    // 1. Resolve the current version's decrypted source (SSE handled upstream).
    const src = await this.objects.openObjectStream(bucket, key);
    if (!src) throw new NoSuchKeyError(key);

    // 2. Passthrough gate: non-image + image/svg+xml are served verbatim by the
    //    normal GET (attachment/CSP-neutralized), never decoded here.
    if (!isTransformableContentType(src.contentType)) {
      src.stream.destroy();
      return this.objects.getObject(req, res, bucket, key);
    }

    // 3. Validate params (400 on bad input) — the trust boundary, before decode.
    let params: TransformParams;
    try {
      params = parseTransformParams(
        req.query as Record<string, unknown>,
        this.config.maxTransformDimension,
      );
    } catch (err) {
      src.stream.destroy();
      throw err;
    }

    // 4. Input-size guard — refuse an oversized source before buffering a byte.
    if (src.size > this.config.maxTransformInputBytes) {
      src.stream.destroy();
      throw new InvalidArgumentError('source too large to transform', 'source-size');
    }

    // 5. Cache lookup key = the response ETag; ext/MIME from the resolved format.
    const output = this.resolveOutput(params.format, src.contentType);
    const hash = DerivativeCacheService.cacheKey(src.etag, params);

    // Honour If-None-Match against the derivative ETag before any work.
    const inm = req.headers['if-none-match'];
    if (typeof inm === 'string' && this.etagMatches(inm, hash)) {
      src.stream.destroy();
      this.setDerivativeHeaders(res, output.mime, hash);
      res.status(304).end();
      return undefined;
    }

    // 6. Produce-once (single-flight): read the source under the byte cap, then
    //    run the bounded sharp pipeline under the concurrency semaphore.
    let consumed = false;
    let entry;
    try {
      entry = await this.cache.getOrCreate(hash, output.ext, async () => {
        consumed = true;
        const input = await this.readBounded(src.stream, this.config.maxTransformInputBytes);
        return this.transform(input, params, output.sharpFormat);
      });
    } finally {
      // On a cache hit (produce never ran) release the source fd we opened.
      if (!consumed && !src.stream.destroyed) src.stream.destroy();
    }

    // 7. Stream the derivative back with immutable, content-addressed caching.
    this.setDerivativeHeaders(res, output.mime, hash);
    res.setHeader('Content-Length', String(entry.size));
    res.status(200);

    const out = entry.stream;
    res.once('close', () => {
      if (!out.destroyed) out.destroy();
    });
    out.on('error', (err) => {
      if (!res.headersSent) res.status(500).end();
      else req.socket.destroy(err);
    });
    out.pipe(res);
    return undefined;
  }

  /** Resolve output {sharpFormat, ext, mime} from the requested/native format. */
  private resolveOutput(
    format: OutputFormat | undefined,
    contentType: string,
  ): { sharpFormat: keyof sharp.FormatEnum; ext: string; mime: string } {
    if (format) {
      return { sharpFormat: format, ext: format, mime: FORMAT_MIME[format] };
    }
    const native = NATIVE_OUTPUT[contentType.split(';', 1)[0].trim().toLowerCase()];
    // isTransformableContentType already gated this, so native is defined; the
    // fallback keeps the types honest without a non-null assertion.
    return native ?? { sharpFormat: 'jpeg', ext: 'jpg', mime: 'image/jpeg' };
  }

  /**
   * The bounded sharp pipeline. `limitInputPixels` makes a decompression bomb
   * throw instead of allocating; `withoutEnlargement` avoids upscaling a small
   * source into a huge buffer; `failOn: 'none'` keeps a slightly-corrupt but
   * decodable image from 500-ing. Any sharp failure is mapped to a 400 (never a
   * 500 / OOM), and the whole decode runs under the concurrency semaphore.
   */
  private async transform(
    input: Buffer,
    params: TransformParams,
    sharpFormat: keyof sharp.FormatEnum,
  ): Promise<Buffer> {
    try {
      return await this.semaphore.run(() =>
        sharp(input, {
          limitInputPixels: this.config.transformLimitInputPixels,
          failOn: 'none',
        })
          .rotate() // honour EXIF orientation
          .resize({
            width: params.width,
            height: params.height,
            fit: params.fit,
            withoutEnlargement: true,
          })
          .toFormat(sharpFormat, { quality: params.quality })
          .toBuffer(),
      );
    } catch (err) {
      this.log.debug(`sharp transform failed: ${(err as Error).message}`);
      throw new InvalidArgumentError('source image could not be transformed');
    }
  }

  /**
   * Read a stream into a Buffer, aborting past `cap` bytes (defence-in-depth
   * beyond the metadata size check — the on-disk blob could disagree). Mirrors
   * the byte-cap abort in `BlobStore.putBlob`.
   */
  private async readBounded(stream: Readable, cap: number): Promise<Buffer> {
    const chunks: Buffer[] = [];
    let total = 0;
    for await (const chunk of stream as AsyncIterable<Buffer>) {
      total += chunk.length;
      if (total > cap) {
        stream.destroy();
        throw new InvalidArgumentError('source too large to transform', 'source-size');
      }
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  }

  /**
   * Headers common to derivative responses (200 and 304). The URL is
   * content-addressed via the source ETag, so the derivative is immutable and
   * far-future cacheable. Transforms are served whole — `Accept-Ranges: none`.
   */
  private setDerivativeHeaders(res: Response, mime: string, hash: string): void {
    res.setHeader('Content-Type', mime);
    res.setHeader('ETag', `"${hash}"`);
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Accept-Ranges', 'none');
  }

  /** True if any comma-separated If-None-Match token matches the derivative ETag. */
  private etagMatches(ifNoneMatch: string, hash: string): boolean {
    const target = `"${hash}"`;
    return ifNoneMatch
      .split(',')
      .map((t) => t.trim())
      .some((t) => t === '*' || t === target || t === `W/${target}`);
  }
}
