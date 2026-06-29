import { Injectable, OnModuleInit } from '@nestjs/common';
import * as crypto from 'node:crypto';

import { InvalidArgumentError } from '../errors/s3-error';

/** What the server needs to resume a list. Opaque to clients. */
export interface ListCursor {
  /** The bucket the list is in. Used to detect token reuse across buckets. */
  b: string;
  /** Key to start *after*. S3 semantics: continuation excludes this key. */
  afterKey: string;
  /** Delimiter that was in force when the token was issued. */
  delimiter: string | null;
  /** Prefix that was in force. */
  prefix: string;
  /** Version 1 = ListObjectsV2 ordering by key. */
  v: 1;
}

/**
 * HMAC-sealed ListObjectsV2 continuation token (WHITEPAPER §2.10). The cursor is
 * base64url(JSON payload || HMAC-SHA256(secret, payload)[0..12]); the secret is
 * a per-process random 32 bytes, so tokens are valid only within this process —
 * which matches S3's informal "don't store tokens long-term" contract. The HMAC
 * makes a token unforgeable and bound to its bucket.
 */
@Injectable()
export class ContinuationToken implements OnModuleInit {
  private secret!: Buffer;

  onModuleInit(): void {
    this.secret = crypto.randomBytes(32);
  }

  encode(cursor: ListCursor): string {
    const payload = Buffer.from(JSON.stringify(cursor), 'utf8');
    const mac = crypto.createHmac('sha256', this.secret).update(payload).digest().subarray(0, 12);
    return Buffer.concat([payload, mac]).toString('base64url');
  }

  decode(token: string, expectedBucket: string): ListCursor {
    let buf: Buffer;
    try {
      buf = Buffer.from(token, 'base64url');
    } catch {
      throw new InvalidArgumentError('invalid continuation token', 'continuation-token', token);
    }
    if (buf.length < 12) {
      throw new InvalidArgumentError('invalid continuation token', 'continuation-token', token);
    }
    const payload = buf.subarray(0, buf.length - 12);
    const mac = buf.subarray(buf.length - 12);
    const expected = crypto
      .createHmac('sha256', this.secret)
      .update(payload)
      .digest()
      .subarray(0, 12);
    if (mac.length !== expected.length || !crypto.timingSafeEqual(mac, expected)) {
      throw new InvalidArgumentError(
        'continuation token failed validation',
        'continuation-token',
        token,
      );
    }
    let cursor: ListCursor;
    try {
      cursor = JSON.parse(payload.toString('utf8')) as ListCursor;
    } catch {
      throw new InvalidArgumentError('malformed continuation token', 'continuation-token', token);
    }
    if (cursor.v !== 1 || cursor.b !== expectedBucket) {
      throw new InvalidArgumentError(
        'continuation token does not belong to this listing',
        'continuation-token',
        token,
      );
    }
    return cursor;
  }
}
