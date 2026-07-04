import { Injectable } from '@nestjs/common';
import type { Request } from 'express';

import { InvalidBucketNameError, KeyTooLongError } from '../errors/s3-error';

/**
 * Canonical S3 bucket label per AWS naming rules (subset honoured by S3 for
 * path-/vhost-style addressing): 3–63 chars, starts and ends with an
 * alphanumeric, middle chars are alphanumeric + `.` / `-`. See §2.2.
 */
const BUCKET_NAME_RE = /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/;

/**
 * S3's hard object-key limit is 1024 UTF-8 bytes. Enforced here (TASK-2160,
 * CWE-770) so an over-length key is a deterministic 400 rather than reaching
 * `fs.mkdir(..., { recursive: true })` and exploding as an opaque `ENAMETOOLONG`
 * 500 (and fanning out one directory per segment). Complements — does not
 * replace — the per-segment 255-byte cap in `storage/key-codec.ts`.
 */
const MAX_KEY_BYTES = 1024;

/**
 * Resolves the canonical `(bucket, key)` pair for a request. The classifier
 * middleware (STORY-0007) already attached `req.openbucket.{bucket, key,
 * keyRaw, addressingStyle, kind}`; this resolver is the single seam every S3
 * controller uses so the classifier can move later without churn.
 *
 * Throws `InvalidBucketNameError` for:
 *   - `kind !== 's3'`               (programmer-error guard)
 *   - missing bucket                (programmer error on object/bucket routes;
 *                                    GET / for ListBuckets must not call here)
 *   - bucket fails `BUCKET_NAME_RE` or contains `..` traversal
 *
 * Key precedence: `keyRaw` (if set by §2.2-aware classifier) → `key` (M0
 * decoded form) → `''`. Bucket-scope routes legitimately return `''`.
 */
@Injectable()
export class RouteResolver {
  resolve(req: Request): { bucket: string; key: string } {
    const ob = req.openbucket;
    if (!ob || ob.kind !== 's3') {
      throw new InvalidBucketNameError('');
    }

    const bucket = ob.bucket;
    if (!bucket) {
      throw new InvalidBucketNameError('');
    }
    if (!BUCKET_NAME_RE.test(bucket) || bucket.includes('..')) {
      throw new InvalidBucketNameError(bucket);
    }

    const key = ob.keyRaw ?? ob.key ?? '';
    const keyBytes = Buffer.byteLength(key, 'utf8');
    if (keyBytes > MAX_KEY_BYTES) {
      throw new KeyTooLongError(keyBytes);
    }
    return { bucket, key };
  }
}
