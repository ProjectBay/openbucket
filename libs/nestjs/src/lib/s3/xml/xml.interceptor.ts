import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { Observable, from, of } from 'rxjs';
import { map, mergeMap } from 'rxjs/operators';

import { MalformedXMLError } from '../errors/s3-error';
import { XmlParser } from './xml.parser';
import { XmlSerializer } from './xml.serializer';

/**
 * 256 KB ceiling — any S3 config document (Tagging, Lifecycle, CORS, Delete,
 * CompleteMultipartUpload, …) is at most a few tens of KB; anything larger
 * is treated as an attack and rejected with `MalformedXMLError`.
 */
export const MAX_XML_BYTES = 256 * 1024;

/**
 * Operations whose inbound body is XML and must be parsed eagerly so the
 * handler sees a structured `(req as any).xmlBody`. `PutBucketPolicy` is kept
 * in this set so the dispatcher's op-name list lines up with the whitepaper,
 * but it is *diverted* to `JSON_REQUEST_OPS` below (its body is JSON, not XML)
 * and is therefore never run through the XML parser.
 *
 * Note the matching is strictly by operation name: `GET` and `HEAD` are
 * additionally short-circuited because they never carry a request body.
 */
export const XML_REQUEST_OPS = new Set([
  'CreateBucket', // <CreateBucketConfiguration>
  'PutBucketCors',
  'PutBucketLifecycleConfiguration',
  'PutBucketVersioning',
  'PutBucketTagging',
  'PutBucketReplication',
  'PutBucketEncryption',
  'PutBucketAcl',
  'PutBucketPolicy', // JSON, not XML — diverted to JSON_REQUEST_OPS
  'PutObjectLockConfiguration',
  'PutObjectTagging',
  'PutObjectRetention',
  'PutObjectLegalHold',
  'CompleteMultipartUpload',
  'DeleteObjects', // <Delete><Object>... — POST ?delete
]);

/**
 * Operations whose inbound body is JSON rather than XML. The interceptor buffers
 * the raw body (no parse) and attaches it as `(req as any).rawBody` for the
 * handler to `JSON.parse`. `PutBucketPolicy` is the only one in v1 (§2.8.2):
 * S3 bucket policies are JSON documents, not XML.
 */
export const JSON_REQUEST_OPS = new Set(['PutBucketPolicy']);

/**
 * XmlInterceptor — §2.3.2 of the whitepaper.
 *
 * Inbound (only when the operation is in `XML_REQUEST_OPS` and the verb is
 * not GET/HEAD): buffer up to `MAX_XML_BYTES`, parse via `XmlParser`, attach
 * as `(req as any).xmlBody`.
 *
 * Outbound: `undefined` / `null` / `Buffer` / `string` / `{ __raw: true }`
 * pass through unchanged. Any other POJO is serialized via `XmlSerializer`
 * — root element is `value.__root` when set, else `'Result'` — and the
 * response is given `Content-Type: application/xml` plus a byte-accurate
 * `Content-Length`. Streaming `GET /<bucket>/<key>` handlers write the
 * `Response` directly and return `undefined`, so the interceptor short-
 * circuits without touching headers (see §2.3.4 last paragraph).
 */
@Injectable()
export class XmlInterceptor implements NestInterceptor {
  constructor(
    private readonly parser: XmlParser,
    private readonly serializer: XmlSerializer,
  ) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = ctx.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();

    const op = (req as unknown as { openbucket?: { operation?: string } })
      .openbucket?.operation;
    const bodyVerb = req.method !== 'GET' && req.method !== 'HEAD';
    const isJsonOp = op !== undefined && JSON_REQUEST_OPS.has(op);
    const needsXmlBody = op !== undefined && XML_REQUEST_OPS.has(op) && !isJsonOp && bodyVerb;
    const needsRawBody = isJsonOp && bodyVerb;

    let inbound: Observable<void>;
    if (needsXmlBody) {
      inbound = from(this.readXmlBody(req)).pipe(
        map((parsed) => {
          (req as unknown as { xmlBody: unknown }).xmlBody = parsed;
        }),
      );
    } else if (needsRawBody) {
      inbound = from(this.readRawBody(req)).pipe(
        map((raw) => {
          (req as unknown as { rawBody: string }).rawBody = raw;
        }),
      );
    } else {
      inbound = of(undefined);
    }

    return inbound.pipe(
      mergeMap(() => next.handle()),
      map((value) => {
        if (value === undefined || value === null) return value;
        if (Buffer.isBuffer(value)) return value; // raw object bytes
        if (typeof value === 'string') return value; // already serialized
        if ((value as { __raw?: boolean }).__raw) return value;

        // POJO returned by a handler -> XML envelope.
        const rootName = (value as { __root?: string }).__root ?? 'Result';
        const body = this.serializer.serialize(rootName, value);
        res.setHeader('Content-Type', 'application/xml');
        res.setHeader('Content-Length', Buffer.byteLength(body, 'utf8'));
        return body;
      }),
    );
  }

  /** Buffer the raw request body as a UTF-8 string (no parse), capped at
   *  MAX_XML_BYTES. Used for JSON-body ops (`JSON_REQUEST_OPS`). */
  private async readRawBody(req: Request): Promise<string> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      let received = 0;
      req.on('data', (c: Buffer) => {
        received += c.length;
        if (received > MAX_XML_BYTES) {
          req.destroy();
          reject(new MalformedXMLError('request body too large'));
          return;
        }
        chunks.push(c);
      });
      req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      req.on('error', reject);
    });
  }

  private async readXmlBody(req: Request): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      let received = 0;
      req.on('data', (c: Buffer) => {
        received += c.length;
        if (received > MAX_XML_BYTES) {
          req.destroy();
          reject(new MalformedXMLError('XML body too large'));
          return;
        }
        chunks.push(c);
      });
      req.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        if (raw.length === 0) {
          resolve(undefined);
          return;
        }
        try {
          resolve(this.parser.parse(raw));
        } catch (e) {
          reject(new MalformedXMLError((e as Error).message));
        }
      });
      req.on('error', reject);
    });
  }
}
