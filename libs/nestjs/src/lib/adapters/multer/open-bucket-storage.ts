import type { Request } from 'express';
import type { StorageEngine } from 'multer';

import type { OpenBucketService, PresignOptions } from '../../open-bucket.service';
import type {
  KeyStrategy,
  KeyStrategyName,
  UploadValidateOptions,
} from '../../open-bucket-upload';
import type { ImageInfo } from '../../storage/image-info';

/**
 * The OpenBucket commit result the storage engine merges onto the multer file
 * object after a successful write. Read it via `@UploadedToBucket()` (or
 * `file.openBucket` directly). Carries no secret — `url`, when present, is a
 * short-lived presigned GET url.
 */
export interface OpenBucketMulterInfo {
  bucket: string;
  key: string;
  /** Present iff an origin was resolvable / a `presign` option was given. */
  url?: string;
  etag: string;
  /** The RESOLVED (sniffed) content type — never the client's unverified claim. */
  contentType: string;
  size: number;
  /** Present on versioning-enabled buckets. */
  versionId?: string;
  /** Present when the body probed as an image. */
  image?: ImageInfo;
}

// Augment the multer file shape so both the engine (which merges `openBucket`
// onto the committed file) and `@UploadedToBucket()` (which reads it back) are
// type-checked without a hand-rolled cast. This lives in the `./multer` subpath
// only — the headless `.` entry never loads it.
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    // eslint-disable-next-line @typescript-eslint/no-namespace
    namespace Multer {
      interface File {
        /** Set by {@link openBucketStorage} after a successful commit. */
        openBucket?: OpenBucketMulterInfo;
      }
    }
  }
}

/**
 * A per-request key function: derives the object key from the request + file.
 * The returned value is ALWAYS run through `assertSafeKey` (via `uploadFrom`'s
 * `keyStrategy`), so a `../evil` / control-char key is rejected — the raw value
 * is never used as an explicit key.
 */
export type PerRequestKeyFn = (
  req: Request,
  file: Express.Multer.File,
) => string | Promise<string>;

/** Options for {@link openBucketStorage}. */
export interface OpenBucketStorageOptions {
  /** Destination bucket (static or derived per request/file). */
  bucket: string | ((req: Request, file: Express.Multer.File) => string);
  /** A built-in {@link KeyStrategyName}, or a per-request key function. Default `'uuid'`. */
  key?: KeyStrategyName | PerRequestKeyFn;
  /** Declarative validation (static or per-request). */
  validate?:
    | UploadValidateOptions
    | ((req: Request, file: Express.Multer.File) => UploadValidateOptions);
  /** Probe image dimensions. Default: auto for `image/*` resolved types. */
  image?: boolean;
  /** Mint a GET url on the result (passed straight to `uploadFrom`). `false` disables. */
  presign?: PresignOptions | false;
}

/**
 * Resolve the adapter `key` option into an `uploadFrom` `keyStrategy`.
 *
 * The security-critical mapping: a caller-derived key is ALWAYS routed through
 * `keyStrategy` (whose result `uploadFrom` runs through `assertSafeKey`), NEVER
 * through `uploadFrom`'s explicit `key` (which it assigns verbatim). A built-in
 * name maps straight through; a per-request function is awaited here and its
 * result handed to a `() => key` strategy so `assertSafeKey` still guards it —
 * closing path-traversal / control-char injection on caller-supplied keys.
 */
async function resolveKeyStrategy(
  key: OpenBucketStorageOptions['key'],
  req: Request,
  file: Express.Multer.File,
): Promise<KeyStrategy> {
  if (key === undefined) return 'uuid';
  if (typeof key === 'string') return key;
  const derived = await key(req, file);
  return () => derived; // built-in `resolveKey` runs assertSafeKey on the return
}

/**
 * A custom multer `StorageEngine` that streams each incoming busboy part straight
 * through {@link OpenBucketService.uploadFrom} into OpenBucket — no temp file, no
 * full-body buffering. On success it merges the commit result onto the multer file
 * (`file.openBucket`) so `@UploadedToBucket()` can read it; on a later-part failure
 * multer calls `_removeFile`, which rolls back the already-committed object.
 *
 * Wire it into a `FileInterceptor`/`FilesInterceptor` `storage` option:
 *
 * ```ts
 * FileInterceptor('file', {
 *   storage: openBucketStorage(ob, { bucket: 'uploads', key: 'uuid' }),
 * })
 * ```
 *
 * Pair the engine's `validate.maxBytes` (enforced mid-write by the writer) with
 * multer's own `limits.fileSize` for an early busboy-layer cut-off.
 */
export function openBucketStorage(
  ob: OpenBucketService,
  opts: OpenBucketStorageOptions,
): StorageEngine {
  return {
    _handleFile(req, file, cb) {
      void (async () => {
        if (!file.stream) {
          // Misuse: the engine was attached to a non-file field.
          throw new TypeError(
            'openBucketStorage: multer file has no `stream` — attach the engine to a file field only.',
          );
        }
        const bucket = typeof opts.bucket === 'function' ? opts.bucket(req, file) : opts.bucket;
        const validate =
          typeof opts.validate === 'function' ? opts.validate(req, file) : opts.validate;
        const keyStrategy = await resolveKeyStrategy(opts.key, req, file);

        const r = await ob.uploadFrom(file.stream, {
          bucket,
          keyStrategy, // never `key:` — keeps caller keys assertSafeKey-guarded
          validate,
          contentType: file.mimetype, // declared hint; the sniffed type still wins
          filename: file.originalname, // hint for the 'original' strategy / ext
          image: opts.image,
          presign: opts.presign,
        });

        const openBucket: OpenBucketMulterInfo = {
          bucket: r.bucket,
          key: r.key,
          etag: r.etag,
          size: r.size,
          contentType: r.contentType,
        };
        if (r.url !== undefined) openBucket.url = r.url;
        if (r.versionId !== undefined) openBucket.versionId = r.versionId;
        if (r.image !== undefined) openBucket.image = r.image;

        // multer merges these onto `file`; `size` is a recognised field.
        return { size: r.size, openBucket };
      })().then(
        (info) => cb(null, info),
        (err) => {
          // Drain the part so busboy doesn't stall waiting on an unread stream.
          file.stream?.resume?.();
          cb(err); // UploadValidationError | S3 domain error — mapped by the filter
        },
      );
    },

    _removeFile(req, file, cb) {
      const info = file.openBucket;
      if (!info?.key) {
        cb(null); // never committed → nothing to remove
        return;
      }
      ob.deleteObject(info.bucket, info.key).then(
        () => cb(null),
        (err) => cb(err),
      );
    },
  };
}
