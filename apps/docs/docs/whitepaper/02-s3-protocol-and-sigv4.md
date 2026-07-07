---
description: How OpenBucket implements the Amazon S3 wire protocol and AWS Signature V4 auth — request routing, XML parsing, error envelopes, and every S3 operation.
---

# 2. S3 Wire Protocol & SigV4 Authentication

This section specifies the S3 surface of OpenBucket end-to-end: how requests are
dispatched to the right handler, how SigV4 is verified for the three signing
variants we accept, how XML is parsed and serialized, how S3 errors are encoded,
and how every supported S3 operation maps onto an HTTP route. The reader is
assumed to have read [§1 — Architecture & Topology] and understands that a
classifier middleware (owned by the backend-architect agent) has already tagged
each request with `req.openbucket.kind`, `req.openbucket.bucket`, and
`req.openbucket.style` before this layer sees it.

The S3 controller tree lives under `apps/backend/src/s3/`. Every file path
below is absolute against that root.

---

## 2.1. Topology of the S3 controller tree

S3's URL grammar is *not* resource-shaped in a way that maps cleanly to one
controller per HTTP resource. The same path `/<bucket>` answers ten different
operations distinguished only by query strings (`?versioning`, `?cors`,
`?lifecycle`, `?tagging`, `?uploads`, …) and the same path `/<bucket>/<key>`
distinguishes single-PUT from multipart-part-upload by the presence of
`?uploadId=…&partNumber=…`. We therefore split the controllers **by resource
class** (service, bucket, object, multipart) and use NestJS's query/header
matchers plus a small `@OperationDispatcher` decorator to fan one HTTP route
out to many operation handlers.

```
apps/backend/src/s3/
  s3.module.ts
  controllers/
    service.controller.ts          // GET /  -> ListBuckets
    bucket.controller.ts           // /:bucket — all bucket-scope ops
    object.controller.ts           // /:bucket/:key(*) — all object-scope ops
    multipart.controller.ts        // multipart sub-operations
  sigv4/
    sigv4.guard.ts
    sigv4.verifier.ts
    canonical-request.ts
    presigned.ts
    key.service.ts                 // interface only; impl in persistence
  xml/
    xml.interceptor.ts
    xml.serializer.ts
    xml.parser.ts
  errors/
    s3-error.ts                    // abstract base + taxonomy
    s3-exception.filter.ts
  routing/
    route-resolver.ts              // virtual-host vs path-style
    operation.decorator.ts         // @S3Operation('PutObject', {...})
  pagination/
    continuation-token.ts
  cors/
    cors.controller.ts             // OPTIONS preflight per bucket
```

The S3 module is mounted last in `AppModule`'s controller list; the classifier
middleware [see §1] ensures requests under `/admin/*`, `/api/admin/*`, or the
SPA asset prefix never reach it. The S3 controllers are catch-all relative to
that exclusion.

### 2.1.1. Controller skeleton

```ts
// apps/backend/src/s3/controllers/object.controller.ts
import {
  Controller,
  Delete,
  Get,
  Head,
  Headers,
  Param,
  Post,
  Put,
  Query,
  Req,
  Res,
  UseFilters,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { SigV4Guard } from '../sigv4/sigv4.guard';
import { S3ExceptionFilter } from '../errors/s3-exception.filter';
import { XmlInterceptor } from '../xml/xml.interceptor';
import { S3Operation } from '../routing/operation.decorator';
import { RouteResolver } from '../routing/route-resolver';
import { ObjectService } from '../../domain/objects/object.service';
import { MultipartService } from '../../domain/multipart/multipart.service';

@Controller()
@UseGuards(SigV4Guard)
@UseFilters(S3ExceptionFilter)
@UseInterceptors(XmlInterceptor)
export class ObjectController {
  constructor(
    private readonly objects: ObjectService,
    private readonly multipart: MultipartService,
    private readonly routes: RouteResolver,
  ) {}

  // --- PUT family --------------------------------------------------------
  // Dispatches PutObject, UploadPart, CopyObject, UploadPartCopy,
  // PutObjectTagging, PutObjectAcl, PutObjectRetention, PutObjectLegalHold.
  @Put(':bucketOrKey/*')
  @Put(':bucketOrKey')
  async put(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const { bucket, key } = this.routes.resolve(req);
    const q = req.query as Record<string, string | undefined>;

    if (q.uploadId !== undefined && q.partNumber !== undefined) {
      if (req.headers['x-amz-copy-source'] !== undefined) {
        return this.multipart.uploadPartCopy(req, res, bucket, key, q);
      }
      return this.multipart.uploadPart(req, res, bucket, key, q);
    }
    if ('tagging' in q)      return this.objects.putTagging(req, bucket, key);
    if ('acl' in q)          return this.objects.putAcl(req, bucket, key);
    if ('retention' in q)    return this.objects.putRetention(req, bucket, key);
    if ('legal-hold' in q)   return this.objects.putLegalHold(req, bucket, key);
    if (req.headers['x-amz-copy-source']) {
      return this.objects.copyObject(req, res, bucket, key);
    }
    return this.objects.putObject(req, res, bucket, key);
  }

  // --- GET family --------------------------------------------------------
  @Get(':bucketOrKey/*')
  @Get(':bucketOrKey')
  async get(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const { bucket, key } = this.routes.resolve(req);
    const q = req.query as Record<string, string | undefined>;

    if ('tagging' in q)    return this.objects.getTagging(req, bucket, key);
    if ('acl' in q)        return this.objects.getAcl(req, bucket, key);
    if ('retention' in q)  return this.objects.getRetention(req, bucket, key);
    if ('legal-hold' in q) return this.objects.getLegalHold(req, bucket, key);
    if (q.uploadId !== undefined) {
      return this.multipart.listParts(req, bucket, key, q.uploadId);
    }
    return this.objects.getObject(req, res, bucket, key);
  }

  @Head(':bucketOrKey/*')
  @Head(':bucketOrKey')
  async head(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const { bucket, key } = this.routes.resolve(req);
    return this.objects.headObject(req, res, bucket, key);
  }

  // --- POST family (multipart init/complete + browser-form PostObject) ---
  @Post(':bucketOrKey/*')
  @Post(':bucketOrKey')
  async post(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const { bucket, key } = this.routes.resolve(req);
    const q = req.query as Record<string, string | undefined>;

    if ('uploads' in q)       return this.multipart.createUpload(req, res, bucket, key);
    if (q.uploadId)           return this.multipart.completeUpload(req, res, bucket, key, q.uploadId);
    if ('restore' in q)       return this.objects.restoreObject(req, bucket, key);
    if ('select' in q)        throw new NotImplementedError('SelectObjectContent');
    return this.objects.postObject(req, res, bucket, key); // browser form upload
  }

  // --- DELETE ------------------------------------------------------------
  @Delete(':bucketOrKey/*')
  @Delete(':bucketOrKey')
  async delete(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const { bucket, key } = this.routes.resolve(req);
    const q = req.query as Record<string, string | undefined>;
    if (q.uploadId !== undefined) {
      return this.multipart.abortUpload(req, res, bucket, key, q.uploadId);
    }
    if ('tagging' in q) return this.objects.deleteTagging(req, bucket, key);
    return this.objects.deleteObject(req, res, bucket, key);
  }
}
```

The `BucketController` is structured identically but switches on the
bucket-scope query flags (`?versioning`, `?cors`, `?lifecycle`, etc.) and
exposes `DELETE /:bucket` plus `POST /:bucket?delete` for bulk delete.

The `:bucketOrKey` parameter name is a deliberate decoy — its actual meaning
depends on the routing style and is resolved by `RouteResolver` [see §2.2],
not by Nest's path parser.

---

## 2.2. Virtual-host vs path-style routing

The classifier middleware (backend-architect's responsibility) attaches the
following structure to every request before it reaches a guard:

```ts
// apps/backend/src/common/openbucket-request.d.ts
declare module 'express-serve-static-core' {
  interface Request {
    openbucket: {
      kind: 's3' | 'admin' | 'spa';
      style: 'virtual-host' | 'path';
      bucket: string | null;       // null only for ListBuckets (GET /)
      keyRaw: string | null;       // raw, not URL-decoded; null for bucket-scope
      requestId: string;           // UUID v7
      receivedAt: number;          // Date.now() at first byte
    };
  }
}
```

`RouteResolver` consumes the classifier's output and returns the canonical
`(bucket, key)` pair to every controller handler. Controllers do not parse the
URL themselves — they ask the resolver.

```ts
// apps/backend/src/s3/routing/route-resolver.ts
import { Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { InvalidBucketNameError } from '../errors/s3-error';

const BUCKET_NAME_RE = /^[a-z0-9][a-z0-9.\-]{1,61}[a-z0-9]$/;

@Injectable()
export class RouteResolver {
  resolve(req: Request): { bucket: string; key: string } {
    const ob = req.openbucket;
    if (!ob || ob.kind !== 's3') {
      // Should never happen — classifier would have routed elsewhere.
      throw new InvalidBucketNameError('');
    }

    const bucket = ob.bucket;
    if (bucket === null) {
      // GET / (ListBuckets) — controllers that depend on a bucket should
      // never call resolve(); this guard catches programmer error.
      throw new InvalidBucketNameError('');
    }
    if (!BUCKET_NAME_RE.test(bucket) || bucket.includes('..')) {
      throw new InvalidBucketNameError(bucket);
    }

    // Object key is whatever path remained after stripping the bucket prefix
    // (path style) or the entire path minus the leading slash (virtual-host
    // style). The classifier has already done that split.
    const key = ob.keyRaw ?? '';

    // S3 keys are 1..1024 UTF-8 bytes. Empty key on an object route means
    // the URL didn't carry a key segment — the bucket-scope controller
    // should have matched instead. We reach here only for bucket routes;
    // returning '' is safe.
    return { bucket, key };
  }
}
```

The classifier guarantees these invariants by the time a request reaches the
guard:

1. Path style: `host` is the configured endpoint (or any non-bucket label).
   The first path segment is the bucket; everything after is the key.
2. Virtual-host style: `host` matches `<bucket>.<endpoint>`. The full path
   (minus leading `/`) is the key.
3. Either style: leading and trailing whitespace stripped from the bucket,
   percent-decoded once for the key.

Because the controllers consume `req.openbucket.bucket` / `keyRaw` directly,
they work identically under both styles — the route patterns
(`/:bucketOrKey/*` etc.) match against the URL Express sees, and the resolver
overrides what they mean.

---

## 2.3. XML request/response handling

### 2.3.1. Why `fast-xml-parser` v4

S3 uses XML for a handful of small documents on the request side
(`CreateBucketConfiguration`, `Tagging`, `CompleteMultipartUpload`, `Delete`,
lifecycle, CORS, versioning, encryption, object-lock) and for *every*
non-empty response. The parser must:

- Parse with attributes (lifecycle rules use `<Filter>` with attributes).
- Preserve order of repeated elements (`<Part>` inside
  `CompleteMultipartUpload`).
- Refuse XXE — no external entity resolution, no DOCTYPE.
- Reject documents over a small ceiling — S3 metadata bodies are at most a
  few tens of KB; anything larger is an attack.

`fast-xml-parser@4.4.x` satisfies all four. It's pure JS (no native build),
runs comfortably in the Node event loop, and has explicit options for
attribute parsing, array hints, and entity processing. Alternatives
considered:

- `xml2js` — slower, weak XXE story, awkward attribute handling.
- `libxmljs2` — native binding, alpine/musl build friction. Not worth it.

### 2.3.2. XmlInterceptor

```ts
// apps/backend/src/s3/xml/xml.interceptor.ts
import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { Observable, from, of } from 'rxjs';
import { map, mergeMap } from 'rxjs/operators';
import { XmlParser } from './xml.parser';
import { XmlSerializer } from './xml.serializer';
import { MalformedXMLError } from '../errors/s3-error';

const MAX_XML_BYTES = 256 * 1024; // 256 KB; any S3 config doc fits well inside.

const XML_REQUEST_OPS = new Set([
  'CreateBucket',            // <CreateBucketConfiguration>
  'PutBucketCors',
  'PutBucketLifecycleConfiguration',
  'PutBucketVersioning',
  'PutBucketTagging',
  'PutBucketReplication',
  'PutBucketEncryption',
  'PutBucketAcl',
  'PutBucketPolicy',         // JSON, not XML — skipped by op-name match
  'PutObjectLockConfiguration',
  'PutObjectTagging',
  'PutObjectRetention',
  'PutObjectLegalHold',
  'CompleteMultipartUpload',
  'DeleteObjects',           // <Delete><Object>... — POST ?delete
]);

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

    const op = (req as any).openbucket?.operation as string | undefined;
    const needsXmlBody =
      op !== undefined &&
      XML_REQUEST_OPS.has(op) &&
      req.method !== 'GET' &&
      req.method !== 'HEAD';

    const inbound: Observable<void> = needsXmlBody
      ? from(this.readXmlBody(req)).pipe(
          map((parsed) => {
            (req as any).xmlBody = parsed;
          }),
        )
      : of(undefined);

    return inbound.pipe(
      mergeMap(() => next.handle()),
      map((value) => {
        if (value === undefined || value === null) return value;
        if (Buffer.isBuffer(value)) return value;        // raw object bytes
        if (typeof value === 'string') return value;     // already serialized
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
```

### 2.3.3. Parser

```ts
// apps/backend/src/s3/xml/xml.parser.ts
import { Injectable } from '@nestjs/common';
import { XMLParser } from 'fast-xml-parser';
import { MalformedXMLError } from '../errors/s3-error';

@Injectable()
export class XmlParser {
  private readonly parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    parseAttributeValue: true,
    parseTagValue: true,
    trimValues: true,
    processEntities: false,        // XXE defence: no entity processing.
    htmlEntities: false,
    allowBooleanAttributes: false,
    // Hint arrays for elements that S3 documents repeat:
    isArray: (name) =>
      [
        'Part',
        'Object',
        'Rule',
        'CORSRule',
        'AllowedOrigin',
        'AllowedMethod',
        'AllowedHeader',
        'ExposeHeader',
        'Tag',
        'Grant',
        'NoncurrentVersionTransition',
        'Transition',
      ].includes(name),
  });

  parse(xml: string): unknown {
    // Cheap pre-check: reject any DOCTYPE outright.
    if (/<!DOCTYPE/i.test(xml)) {
      throw new MalformedXMLError('DOCTYPE not allowed');
    }
    const parsed = this.parser.parse(xml);
    if (!parsed || typeof parsed !== 'object') {
      throw new MalformedXMLError('expected root element');
    }
    return parsed;
  }
}
```

### 2.3.4. Serializer

```ts
// apps/backend/src/s3/xml/xml.serializer.ts
import { Injectable } from '@nestjs/common';
import { XMLBuilder } from 'fast-xml-parser';

const XML_NS = 'http://s3.amazonaws.com/doc/2006-03-01/';

@Injectable()
export class XmlSerializer {
  private readonly builder = new XMLBuilder({
    attributeNamePrefix: '@_',
    ignoreAttributes: false,
    format: false,                    // S3 wire format isn't pretty-printed.
    suppressEmptyNode: false,
    processEntities: true,
    suppressBooleanAttributes: false,
  });

  serialize(rootName: string, value: unknown): string {
    // Strip internal hints before building.
    const cleaned = this.stripInternals(value);
    const doc = {
      '?xml': { '@_version': '1.0', '@_encoding': 'UTF-8' },
      [rootName]: {
        '@_xmlns': XML_NS,
        ...(cleaned as object),
      },
    };
    return this.builder.build(doc);
  }

  private stripInternals(v: unknown): unknown {
    if (Array.isArray(v)) return v.map((x) => this.stripInternals(x));
    if (v && typeof v === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, val] of Object.entries(v)) {
        if (k === '__root' || k === '__raw') continue;
        out[k] = this.stripInternals(val);
      }
      return out;
    }
    return v;
  }
}
```

Handlers either:

- return a POJO with `__root: 'ListBucketResult'` (or whichever AWS root
  element name applies) — the interceptor serializes it and sets
  `Content-Type: application/xml`; or
- return a `Buffer` or `{ __raw: true }` envelope for binary object payloads
  and 200/204 responses that carry no body — the interceptor passes through.

For `GET /<bucket>/<key>` the handler writes directly to the `Response`
stream via the streaming agent's pipe primitive [see §3] and returns
`undefined`; the interceptor short-circuits.

---

## 2.4. SigV4 verification

### 2.4.1. The three signing variants we accept

| Variant | Carrier | Notes |
|---|---|---|
| Header-based | `Authorization: AWS4-HMAC-SHA256 …` + `X-Amz-Date` + `X-Amz-Content-Sha256` | The common case. SDK default for short bodies. |
| Presigned URL | `X-Amz-Algorithm=AWS4-HMAC-SHA256` + `X-Amz-Signature=…` query params | Used for browser uploads and CLI `presign`. |
| Chunked-payload | `Authorization: AWS4-HMAC-SHA256 …` + `x-amz-content-sha256: STREAMING-AWS4-HMAC-SHA256-PAYLOAD` | **Rejected in v1 — see §2.4.6.** |

Trailing-checksum (`STREAMING-UNSIGNED-PAYLOAD-TRAILER`) is *accepted* — the
seed signature is verified normally; the trailer is validated only as a
checksum, not as auth.

### 2.4.2. KeyService — the persistence boundary

The guard never touches MikroORM. It depends on the abstract:

```ts
// apps/backend/src/s3/sigv4/key.service.ts
export interface AccessKey {
  accessKeyId: string;
  secretAccessKey: string;
  disabled: boolean;
}

export abstract class KeyService {
  /**
   * Resolve an access key id to its secret.
   *
   * Contract:
   *  - Returns null if the access key id is unknown OR is disabled.
   *  - MUST be constant-time across all known/unknown branches at the
   *    *caller's* level — i.e., it is acceptable for this method to return
   *    quickly with null; the SigV4Guard wraps the comparison in
   *    timingSafeEqual to prevent timing leakage of the secret itself.
   *  - The implementation MAY cache results in memory for up to 60 s.
   *  - Implementation belongs to the persistence agent (see §4).
   */
  abstract getSecret(accessKeyId: string): Promise<AccessKey | null>;
}
```

The persistence agent provides the concrete `SqliteKeyService` implementing
this interface; the S3 module imports the abstract token only.

### 2.4.3. SigV4Guard

```ts
// apps/backend/src/s3/sigv4/sigv4.guard.ts
import {
  CanActivate,
  ExecutionContext,
  Injectable,
} from '@nestjs/common';
import type { Request } from 'express';
import { KeyService } from './key.service';
import {
  AccessDeniedError,
  InvalidArgumentError,
  RequestTimeTooSkewedError,
  SignatureDoesNotMatchError,
} from '../errors/s3-error';
import { Sigv4Verifier } from './sigv4.verifier';
import { verifyPresigned } from './presigned';

const MAX_SKEW_MS = 15 * 60 * 1000;        // AWS default ±15 minutes.
const STREAMING_SHA = 'STREAMING-AWS4-HMAC-SHA256-PAYLOAD';

@Injectable()
export class SigV4Guard implements CanActivate {
  constructor(
    private readonly keys: KeyService,
    private readonly verifier: Sigv4Verifier,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<Request>();

    // Reject chunked-upload signing per §2.4.6.
    const contentSha = (req.headers['x-amz-content-sha256'] as string | undefined) ?? '';
    if (contentSha === STREAMING_SHA) {
      throw new InvalidArgumentError(
        'STREAMING-AWS4-HMAC-SHA256-PAYLOAD is not supported. ' +
          'Set x-amz-content-sha256: UNSIGNED-PAYLOAD instead.',
        'x-amz-content-sha256',
        STREAMING_SHA,
      );
    }

    const query = req.query as Record<string, string | undefined>;
    if (query['X-Amz-Signature']) {
      return this.checkPresigned(req);
    }
    return this.checkHeader(req);
  }

  // -------- Header-based ------------------------------------------------
  private async checkHeader(req: Request): Promise<boolean> {
    const authz = req.headers['authorization'];
    if (typeof authz !== 'string' || !authz.startsWith('AWS4-HMAC-SHA256 ')) {
      throw new AccessDeniedError('missing or unsupported Authorization header');
    }
    const amzDate = req.headers['x-amz-date'];
    if (typeof amzDate !== 'string') {
      throw new AccessDeniedError('missing X-Amz-Date');
    }
    this.checkSkew(amzDate);

    const parsed = this.parseAuthorization(authz);
    const key = await this.keys.getSecret(parsed.accessKeyId);
    if (!key) throw new SignatureDoesNotMatchError();

    const expected = await this.verifier.signatureForHeaderRequest({
      req,
      secretAccessKey: key.secretAccessKey,
      credentialScope: parsed.credentialScope,
      signedHeaders: parsed.signedHeaders,
      amzDate,
    });

    if (!this.verifier.constantTimeEquals(expected, parsed.signature)) {
      throw new SignatureDoesNotMatchError();
    }

    (req as any).openbucket.accessKeyId = parsed.accessKeyId;
    return true;
  }

  // -------- Presigned --------------------------------------------------
  private async checkPresigned(req: Request): Promise<boolean> {
    const ok = await verifyPresigned(req, this.keys, this.verifier);
    if (!ok) throw new SignatureDoesNotMatchError();
    return true;
  }

  // -------- Helpers ----------------------------------------------------
  private parseAuthorization(authz: string): {
    accessKeyId: string;
    credentialScope: string;        // e.g. 20260520/us-east-1/s3/aws4_request
    signedHeaders: string[];
    signature: string;
  } {
    // Format: AWS4-HMAC-SHA256 Credential=AKID/20260520/us-east-1/s3/aws4_request,
    //                          SignedHeaders=host;x-amz-content-sha256;x-amz-date,
    //                          Signature=hex…
    const body = authz.slice('AWS4-HMAC-SHA256 '.length);
    const parts: Record<string, string> = {};
    for (const seg of body.split(',')) {
      const [k, v] = seg.trim().split('=');
      if (k && v) parts[k] = v;
    }
    const cred = parts['Credential'];
    if (!cred) throw new AccessDeniedError('missing Credential');
    const credParts = cred.split('/');
    if (credParts.length !== 5) throw new AccessDeniedError('malformed Credential');
    const [accessKeyId, date, region, service, terminator] = credParts;
    if (service !== 's3' || terminator !== 'aws4_request') {
      throw new AccessDeniedError('unexpected credential scope');
    }
    return {
      accessKeyId,
      credentialScope: `${date}/${region}/${service}/${terminator}`,
      signedHeaders: (parts['SignedHeaders'] ?? '').split(';').filter(Boolean),
      signature: parts['Signature'] ?? '',
    };
  }

  private checkSkew(amzDate: string): void {
    // amzDate is ISO basic: YYYYMMDDTHHMMSSZ
    const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(amzDate);
    if (!m) throw new AccessDeniedError('malformed X-Amz-Date');
    const t = Date.UTC(
      Number(m[1]), Number(m[2]) - 1, Number(m[3]),
      Number(m[4]), Number(m[5]), Number(m[6]),
    );
    if (Math.abs(Date.now() - t) > MAX_SKEW_MS) {
      throw new RequestTimeTooSkewedError(t);
    }
  }
}
```

### 2.4.4. Verifier — canonical request reconstruction

```ts
// apps/backend/src/s3/sigv4/sigv4.verifier.ts
import { Injectable } from '@nestjs/common';
import * as crypto from 'node:crypto';
import type { Request } from 'express';
import { buildCanonicalRequest } from './canonical-request';

@Injectable()
export class Sigv4Verifier {
  /**
   * Reconstruct the canonical request, derive the signing key, and produce
   * the hex signature the client *should* have sent.
   */
  async signatureForHeaderRequest(args: {
    req: Request;
    secretAccessKey: string;
    credentialScope: string;        // 20260520/us-east-1/s3/aws4_request
    signedHeaders: string[];
    amzDate: string;
  }): Promise<string> {
    const { req, secretAccessKey, credentialScope, signedHeaders, amzDate } = args;

    // 1. Payload hash: SDKs send either the body's sha256 in lowercase hex,
    //    or the literal string 'UNSIGNED-PAYLOAD'. The header is part of
    //    the SignedHeaders list, so its value participates in the canonical
    //    request verbatim — we do NOT recompute over the body.
    const payloadHash =
      (req.headers['x-amz-content-sha256'] as string | undefined) ?? 'UNSIGNED-PAYLOAD';

    // 2. Canonical request.
    const canonical = buildCanonicalRequest({
      method: req.method,
      pathname: this.originalPath(req),
      query: this.queryStringForCanonical(req),
      headers: req.headers as Record<string, string | string[] | undefined>,
      signedHeaders,
      payloadHash,
    });

    const hashedCanonical = sha256Hex(canonical);

    // 3. String to sign.
    const stringToSign = [
      'AWS4-HMAC-SHA256',
      amzDate,
      credentialScope,
      hashedCanonical,
    ].join('\n');

    // 4. Derive signing key. scope = date/region/service/aws4_request
    const [date, region, service] = credentialScope.split('/');
    const kDate = hmac(`AWS4${secretAccessKey}`, date);
    const kRegion = hmac(kDate, region);
    const kService = hmac(kRegion, service);
    const kSigning = hmac(kService, 'aws4_request');

    return hmacHex(kSigning, stringToSign);
  }

  constantTimeEquals(a: string, b: string): boolean {
    const ab = Buffer.from(a, 'utf8');
    const bb = Buffer.from(b, 'utf8');
    if (ab.length !== bb.length) return false;
    return crypto.timingSafeEqual(ab, bb);
  }

  private originalPath(req: Request): string {
    // Express has already URL-decoded once. SigV4 wants the *path before*
    // application/x-www-form-urlencoded query splitting but with the path
    // segment URL-encoded per RFC 3986 (twice for S3 V4 — but S3 is the
    // exception that uses single-encoding).
    const u = new URL(`http://h${req.originalUrl}`);
    return u.pathname;
  }

  private queryStringForCanonical(req: Request): string {
    const u = new URL(`http://h${req.originalUrl}`);
    return u.search.startsWith('?') ? u.search.slice(1) : u.search;
  }
}

function sha256Hex(s: string | Buffer): string {
  return crypto.createHash('sha256').update(s).digest('hex');
}
function hmac(key: string | Buffer, data: string): Buffer {
  return crypto.createHmac('sha256', key).update(data, 'utf8').digest();
}
function hmacHex(key: Buffer, data: string): string {
  return crypto.createHmac('sha256', key).update(data, 'utf8').digest('hex');
}
```

### 2.4.5. Canonical request builder

```ts
// apps/backend/src/s3/sigv4/canonical-request.ts
export interface CanonicalRequestInput {
  method: string;
  pathname: string;                                 // already URL-decoded once
  query: string;                                    // raw query, no leading '?'
  headers: Record<string, string | string[] | undefined>;
  signedHeaders: string[];                          // lowercase, alpha-sorted
  payloadHash: string;
}

export function buildCanonicalRequest(c: CanonicalRequestInput): string {
  // 1. CanonicalURI: S3 uses single-pass URI encoding of each path segment.
  const canonicalUri = c.pathname
    .split('/')
    .map((seg) => awsUriEncode(seg, false))
    .join('/');

  // 2. CanonicalQueryString: sort by key, then by value; URI-encode both.
  const canonicalQuery = canonicaliseQuery(c.query);

  // 3. CanonicalHeaders: each signed header, lower-cased name, trimmed value,
  //    sequential whitespace collapsed, terminated with '\n'.
  const headerLines: string[] = [];
  for (const name of c.signedHeaders) {
    const raw = c.headers[name];
    const value = Array.isArray(raw) ? raw.join(',') : (raw ?? '');
    const collapsed = value.trim().replace(/\s+/g, ' ');
    headerLines.push(`${name.toLowerCase()}:${collapsed}\n`);
  }

  const signedHeadersLine = c.signedHeaders.map((h) => h.toLowerCase()).join(';');

  return [
    c.method.toUpperCase(),
    canonicalUri,
    canonicalQuery,
    headerLines.join(''),
    signedHeadersLine,
    c.payloadHash,
  ].join('\n');
}

function canonicaliseQuery(q: string): string {
  if (!q) return '';
  const params: Array<[string, string]> = [];
  for (const segment of q.split('&')) {
    if (!segment) continue;
    const eq = segment.indexOf('=');
    const k = eq === -1 ? segment : segment.slice(0, eq);
    const v = eq === -1 ? '' : segment.slice(eq + 1);
    // Per SigV4, the query string is already URL-encoded in the URL. We
    // decode then re-encode to normalise.
    params.push([awsUriEncode(decodeURIComponent(k), true),
                 awsUriEncode(decodeURIComponent(v), true)]);
  }
  params.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : 1));
  return params.map(([k, v]) => `${k}=${v}`).join('&');
}

/**
 * AWS-flavoured RFC 3986: unreserved = ALPHA / DIGIT / '-' / '.' / '_' / '~'.
 * Slashes are preserved in path segments only when `encodeSlash === false`.
 */
function awsUriEncode(input: string, encodeSlash: boolean): string {
  const out: string[] = [];
  for (const byte of Buffer.from(input, 'utf8')) {
    const c = String.fromCharCode(byte);
    if (
      (byte >= 0x30 && byte <= 0x39) ||  // 0-9
      (byte >= 0x41 && byte <= 0x5a) ||  // A-Z
      (byte >= 0x61 && byte <= 0x7a) ||  // a-z
      c === '-' || c === '_' || c === '.' || c === '~'
    ) {
      out.push(c);
    } else if (c === '/' && !encodeSlash) {
      out.push('/');
    } else {
      out.push('%' + byte.toString(16).toUpperCase().padStart(2, '0'));
    }
  }
  return out.join('');
}
```

The library `aws4` is *also* on the dependency list — we use it as a
cross-check in tests (sign with `aws4.sign`, verify with our verifier, and
vice-versa). In the hot path we use our own implementation because `aws4`'s
API is signing-oriented and inverting it through string-comparison would be
fragile.

### 2.4.6. Chunked-upload rejection (decision)

The streaming variant `STREAMING-AWS4-HMAC-SHA256-PAYLOAD` requires the
server to verify a fresh HMAC for every 8 KiB chunk inside the request body,
each chained to the previous chunk's signature. It is genuinely hostile to
implement on top of Node streams because the chunk boundary is *in the wire
format*, not in `IncomingMessage` chunk events — we'd have to buffer-and-scan
for the `<size>;chunk-signature=…\r\n` framing on every `data` event. The
gain over `UNSIGNED-PAYLOAD` (or even better, `STREAMING-UNSIGNED-PAYLOAD-TRAILER`
with a SHA-256 trailer) is negligible: in both cases the connection-level
authentication is already established by the seed signature.

**Decision for v1: reject.** The guard returns:

```
HTTP/1.1 400 Bad Request
Content-Type: application/xml

<?xml version="1.0" encoding="UTF-8"?>
<Error>
  <Code>InvalidArgument</Code>
  <Message>STREAMING-AWS4-HMAC-SHA256-PAYLOAD is not supported. Set x-amz-content-sha256: UNSIGNED-PAYLOAD instead.</Message>
  <ArgumentName>x-amz-content-sha256</ArgumentName>
  <ArgumentValue>STREAMING-AWS4-HMAC-SHA256-PAYLOAD</ArgumentValue>
  <Resource>/bucket/key</Resource>
  <RequestId>...</RequestId>
</Error>
```

The AWS SDKs (JS v3, Python boto3, Go v2, Java v2) all honour the
`disablePayloadSigning` / `payloadSigningEnabled=false` flag and fall back to
`UNSIGNED-PAYLOAD`. The `aws s3 cp` CLI uses chunked signing by default; the
documented workaround is `--no-payload-signing` (or `s3.payload_signing_enabled = false`
in `~/.aws/config`). Both will be called out in the OpenBucket compatibility
notes section of the README. Re-enabling streaming signing is left to a v2
ticket — see ARCHITECTURE.md §11.

---

## 2.5. Presigned URL verification

A presigned URL carries every signing input in the query string:

```
GET /my-bucket/my-key
  ?X-Amz-Algorithm=AWS4-HMAC-SHA256
  &X-Amz-Credential=AKID%2F20260520%2Fus-east-1%2Fs3%2Faws4_request
  &X-Amz-Date=20260520T120000Z
  &X-Amz-Expires=900
  &X-Amz-SignedHeaders=host
  &X-Amz-Signature=…hex…
```

The verification differs from header-based in three ways:

1. **`X-Amz-Signature` is the field to verify** — `Authorization` is absent.
2. **Expiry is explicit.** `X-Amz-Expires` is seconds (1..604800). The check
   is `now ∈ [X-Amz-Date, X-Amz-Date + X-Amz-Expires]` — the ±15 min skew
   window applies only to the start, not the end.
3. **`X-Amz-Signature` itself is excluded from the canonical query string.**
   Every other `X-Amz-*` query param is included.

```ts
// apps/backend/src/s3/sigv4/presigned.ts
import type { Request } from 'express';
import { KeyService } from './key.service';
import { Sigv4Verifier } from './sigv4.verifier';
import {
  AccessDeniedError,
  InvalidArgumentError,
  RequestTimeTooSkewedError,
} from '../errors/s3-error';
import { buildCanonicalRequest } from './canonical-request';
import * as crypto from 'node:crypto';

const MAX_EXPIRES = 7 * 24 * 60 * 60;       // AWS: max 7 days.
const MAX_SKEW_MS = 15 * 60 * 1000;

export async function verifyPresigned(
  req: Request,
  keys: KeyService,
  verifier: Sigv4Verifier,
): Promise<boolean> {
  const q = req.query as Record<string, string | undefined>;

  const algorithm = q['X-Amz-Algorithm'];
  if (algorithm !== 'AWS4-HMAC-SHA256') {
    throw new InvalidArgumentError('unsupported algorithm', 'X-Amz-Algorithm', algorithm ?? '');
  }

  const credential = q['X-Amz-Credential'];
  const amzDate = q['X-Amz-Date'];
  const expiresStr = q['X-Amz-Expires'];
  const signedHeadersStr = q['X-Amz-SignedHeaders'];
  const presentedSig = q['X-Amz-Signature'];

  if (!credential || !amzDate || !expiresStr || !signedHeadersStr || !presentedSig) {
    throw new AccessDeniedError('missing presigned URL parameter');
  }

  const expires = Number.parseInt(expiresStr, 10);
  if (!Number.isFinite(expires) || expires < 1 || expires > MAX_EXPIRES) {
    throw new InvalidArgumentError('X-Amz-Expires out of range', 'X-Amz-Expires', expiresStr);
  }

  const start = parseAmzDate(amzDate);
  const now = Date.now();
  if (start - MAX_SKEW_MS > now) {
    throw new RequestTimeTooSkewedError(start);
  }
  if (now > start + expires * 1000) {
    // AWS calls this AccessDenied with Message="Request has expired".
    throw new AccessDeniedError('Request has expired');
  }

  const [accessKeyId, date, region, service, terminator] = credential.split('/');
  if (service !== 's3' || terminator !== 'aws4_request') {
    throw new AccessDeniedError('unexpected credential scope');
  }
  const credentialScope = `${date}/${region}/${service}/${terminator}`;

  const key = await keys.getSecret(accessKeyId);
  if (!key) {
    // Defer to a generic SignatureDoesNotMatch — do not leak whether the
    // key id is known.
    return false;
  }

  // Strip X-Amz-Signature from the canonical query.
  const queryWithoutSig = stripParam(req.originalUrl, 'X-Amz-Signature');
  const signedHeaders = signedHeadersStr.split(';').map((s) => s.toLowerCase());

  const canonical = buildCanonicalRequest({
    method: req.method,
    pathname: new URL(`http://h${req.originalUrl}`).pathname,
    query: queryWithoutSig,
    headers: req.headers as Record<string, string | string[] | undefined>,
    signedHeaders,
    payloadHash: 'UNSIGNED-PAYLOAD',
  });

  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    crypto.createHash('sha256').update(canonical).digest('hex'),
  ].join('\n');

  const kDate    = crypto.createHmac('sha256', `AWS4${key.secretAccessKey}`).update(date).digest();
  const kRegion  = crypto.createHmac('sha256', kDate).update(region).digest();
  const kService = crypto.createHmac('sha256', kRegion).update(service).digest();
  const kSigning = crypto.createHmac('sha256', kService).update('aws4_request').digest();
  const expected = crypto.createHmac('sha256', kSigning).update(stringToSign).digest('hex');

  if (!verifier.constantTimeEquals(expected, presentedSig)) {
    return false;
  }
  (req as any).openbucket.accessKeyId = accessKeyId;
  return true;
}

function parseAmzDate(s: string): number {
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(s);
  if (!m) throw new AccessDeniedError('malformed X-Amz-Date');
  return Date.UTC(
    Number(m[1]), Number(m[2]) - 1, Number(m[3]),
    Number(m[4]), Number(m[5]), Number(m[6]),
  );
}

function stripParam(url: string, name: string): string {
  const u = new URL(`http://h${url}`);
  u.searchParams.delete(name);
  const q = u.search.startsWith('?') ? u.search.slice(1) : u.search;
  return q;
}
```

A presigned `PUT` can be uploaded with an empty `Authorization` header and
arbitrary body bytes; the seed signature already binds the request method,
URL, and `host` header. We do not verify any payload hash on presigned PUTs
unless the client opted-in by including `X-Amz-Content-Sha256` in the
SignedHeaders list — in which case the verifier picks it up like any other
signed header.

---

## 2.6. S3 error taxonomy

All errors thrown inside the S3 controller tree extend `S3Error`. The base
class captures the four pieces of an AWS error: code, message, HTTP status,
and a place for the resource and request id to be injected by the filter.

```ts
// apps/backend/src/s3/errors/s3-error.ts
export abstract class S3Error extends Error {
  abstract readonly code: string;
  abstract readonly httpStatus: number;
  resource?: string;
  requestId?: string;

  /** Optional AWS-specific extra fields (rendered as elements). */
  extra: Record<string, string | number | undefined> = {};

  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
  }
}

// -- 400 --------------------------------------------------------------
export class InvalidBucketNameError extends S3Error {
  readonly code = 'InvalidBucketName';
  readonly httpStatus = 400;
  constructor(bucket: string) {
    super(`The specified bucket is not valid: ${bucket}`);
    this.extra.BucketName = bucket;
  }
}
export class InvalidArgumentError extends S3Error {
  readonly code = 'InvalidArgument';
  readonly httpStatus = 400;
  constructor(message: string, argName?: string, argValue?: string) {
    super(message);
    if (argName !== undefined)  this.extra.ArgumentName = argName;
    if (argValue !== undefined) this.extra.ArgumentValue = argValue;
  }
}
export class MalformedXMLError extends S3Error {
  readonly code = 'MalformedXML';
  readonly httpStatus = 400;
  constructor(detail = 'The XML you provided was not well-formed') {
    super(detail);
  }
}
export class InvalidPartError extends S3Error {
  readonly code = 'InvalidPart';
  readonly httpStatus = 400;
  constructor(partNumber?: number) {
    super('One or more of the specified parts could not be found.');
    if (partNumber !== undefined) this.extra.PartNumber = partNumber;
  }
}
export class InvalidPartOrderError extends S3Error {
  readonly code = 'InvalidPartOrder';
  readonly httpStatus = 400;
  constructor() {
    super('The list of parts was not in ascending order.');
  }
}
export class InvalidRequestError extends S3Error {
  readonly code = 'InvalidRequest';
  readonly httpStatus = 400;
}
export class EntityTooSmallError extends S3Error {
  readonly code = 'EntityTooSmall';
  readonly httpStatus = 400;
  constructor() {
    super('Your proposed upload is smaller than the minimum allowed object size.');
  }
}
export class IncompleteBodyError extends S3Error {
  readonly code = 'IncompleteBody';
  readonly httpStatus = 400;
}
export class MissingContentLengthError extends S3Error {
  readonly code = 'MissingContentLength';
  readonly httpStatus = 411;
}
export class RequestTimeTooSkewedError extends S3Error {
  readonly code = 'RequestTimeTooSkewed';
  readonly httpStatus = 403;
  constructor(serverTime: number) {
    super('The difference between the request time and the current time is too large.');
    this.extra.ServerTime = new Date(serverTime).toISOString();
    this.extra.RequestTime = new Date().toISOString();
  }
}

// -- 403 --------------------------------------------------------------
export class AccessDeniedError extends S3Error {
  readonly code = 'AccessDenied';
  readonly httpStatus = 403;
  constructor(message = 'Access Denied') { super(message); }
}
export class SignatureDoesNotMatchError extends S3Error {
  readonly code = 'SignatureDoesNotMatch';
  readonly httpStatus = 403;
  constructor() {
    super(
      'The request signature we calculated does not match the signature you provided. ' +
      'Check your key and signing method.',
    );
  }
}

// -- 404 --------------------------------------------------------------
export class NoSuchBucketError extends S3Error {
  readonly code = 'NoSuchBucket';
  readonly httpStatus = 404;
  constructor(bucket: string) {
    super('The specified bucket does not exist');
    this.extra.BucketName = bucket;
  }
}
export class NoSuchKeyError extends S3Error {
  readonly code = 'NoSuchKey';
  readonly httpStatus = 404;
  constructor(key: string) {
    super('The specified key does not exist.');
    this.extra.Key = key;
  }
}
export class NoSuchUploadError extends S3Error {
  readonly code = 'NoSuchUpload';
  readonly httpStatus = 404;
  constructor() { super('The specified multipart upload does not exist.'); }
}
export class NoSuchVersionError extends S3Error {
  readonly code = 'NoSuchVersion';
  readonly httpStatus = 404;
}
export class NoSuchCORSConfigurationError extends S3Error {
  readonly code = 'NoSuchCORSConfiguration';
  readonly httpStatus = 404;
}
export class NoSuchLifecycleConfigurationError extends S3Error {
  readonly code = 'NoSuchLifecycleConfiguration';
  readonly httpStatus = 404;
}
export class NoSuchBucketPolicyError extends S3Error {
  readonly code = 'NoSuchBucketPolicy';
  readonly httpStatus = 404;
}
export class NoSuchTagSetError extends S3Error {
  readonly code = 'NoSuchTagSet';
  readonly httpStatus = 404;
}

// -- 409 --------------------------------------------------------------
export class BucketAlreadyExistsError extends S3Error {
  readonly code = 'BucketAlreadyExists';
  readonly httpStatus = 409;
}
export class BucketAlreadyOwnedByYouError extends S3Error {
  readonly code = 'BucketAlreadyOwnedByYou';
  readonly httpStatus = 409;
}
export class BucketNotEmptyError extends S3Error {
  readonly code = 'BucketNotEmpty';
  readonly httpStatus = 409;
}
export class InvalidBucketStateError extends S3Error {
  readonly code = 'InvalidBucketState';
  readonly httpStatus = 409;
}
export class OperationAbortedError extends S3Error {
  readonly code = 'OperationAborted';
  readonly httpStatus = 409;
}

// -- 411 / 412 --------------------------------------------------------
export class PreconditionFailedError extends S3Error {
  readonly code = 'PreconditionFailed';
  readonly httpStatus = 412;
}

// -- 413 / 416 --------------------------------------------------------
export class EntityTooLargeError extends S3Error {
  readonly code = 'EntityTooLarge';
  readonly httpStatus = 413;
  constructor(proposed: number, max: number) {
    super('Your proposed upload exceeds the maximum allowed object size.');
    this.extra.ProposedSize = proposed;
    this.extra.MaxSizeAllowed = max;
  }
}
export class InvalidRangeError extends S3Error {
  readonly code = 'InvalidRange';
  readonly httpStatus = 416;
}

// -- 501 --------------------------------------------------------------
export class NotImplementedError extends S3Error {
  readonly code = 'NotImplemented';
  readonly httpStatus = 501;
  constructor(op: string) {
    super(`The ${op} operation is not implemented by OpenBucket.`);
    this.extra.Operation = op;
  }
}

// -- 503 --------------------------------------------------------------
export class ServiceUnavailableError extends S3Error {
  readonly code = 'ServiceUnavailable';
  readonly httpStatus = 503;
}
export class SlowDownError extends S3Error {
  readonly code = 'SlowDown';
  readonly httpStatus = 503;
}

// -- 500 --------------------------------------------------------------
export class InternalError extends S3Error {
  readonly code = 'InternalError';
  readonly httpStatus = 500;
  constructor() {
    super('We encountered an internal error. Please try again.');
  }
}
```

---

## 2.7. The S3 XML exception filter

The backend-architect agent provides the boilerplate that registers this
filter on the S3 controller tree and excludes the admin tree from it. This
section provides the body.

```ts
// apps/backend/src/s3/errors/s3-exception.filter.ts
import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { XMLBuilder } from 'fast-xml-parser';
import { InternalError, S3Error } from './s3-error';

const builder = new XMLBuilder({
  attributeNamePrefix: '@_',
  ignoreAttributes: false,
  format: false,
  suppressEmptyNode: true,
  processEntities: true,
});

@Catch()
export class S3ExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(S3ExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const req = ctx.getRequest<Request>();
    const res = ctx.getResponse<Response>();

    const err = this.normalise(exception);
    const requestId = (req as any).openbucket?.requestId ?? 'unknown';
    const resource = this.resourceFor(req);

    if (err.httpStatus >= 500) {
      this.logger.error(
        { code: err.code, requestId, message: err.message, stack: (exception as Error)?.stack },
        's3 internal error',
      );
    } else {
      this.logger.debug(
        { code: err.code, requestId, message: err.message },
        's3 client error',
      );
    }

    const body = builder.build({
      '?xml': { '@_version': '1.0', '@_encoding': 'UTF-8' },
      Error: {
        Code: err.code,
        Message: err.message,
        ...err.extra,
        Resource: resource,
        RequestId: requestId,
        HostId: requestId,                     // we have no separate host id
      },
    });

    if (res.headersSent) {
      // The handler began streaming before the error; we can only abort.
      res.destroy(err);
      return;
    }

    res.status(err.httpStatus);
    res.setHeader('Content-Type', 'application/xml');
    res.setHeader('x-amz-request-id', requestId);
    res.setHeader('Content-Length', Buffer.byteLength(body, 'utf8'));

    // HEAD must not write a body, even on error — AWS parity.
    if (req.method === 'HEAD') {
      res.end();
    } else {
      res.end(body);
    }
  }

  private normalise(exception: unknown): S3Error {
    if (exception instanceof S3Error) return exception;
    if (exception instanceof HttpException) {
      // Convert Nest 404/405/etc. into S3-shaped errors.
      const status = exception.getStatus();
      const wrapped = new InternalError();
      (wrapped as { httpStatus: number }).httpStatus = status;
      (wrapped as { code: string }).code =
        status === 405 ? 'MethodNotAllowed' :
        status === 404 ? 'NoSuchKey' :
        'InternalError';
      (wrapped as { message: string }).message =
        (exception.getResponse() as { message?: string })?.message ?? exception.message;
      return wrapped as S3Error;
    }
    return new InternalError();
  }

  private resourceFor(req: Request): string {
    const ob = (req as any).openbucket;
    if (!ob) return req.originalUrl;
    if (ob.bucket && ob.keyRaw) return `/${ob.bucket}/${ob.keyRaw}`;
    if (ob.bucket) return `/${ob.bucket}`;
    return '/';
  }
}
```

Sample emitted body:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<Error>
  <Code>NoSuchKey</Code>
  <Message>The specified key does not exist.</Message>
  <Key>photos/2026/sunset.jpg</Key>
  <Resource>/my-bucket/photos/2026/sunset.jpg</Resource>
  <RequestId>01913e4a-…</RequestId>
  <HostId>01913e4a-…</HostId>
</Error>
```

---

## 2.8. Operation route table

The table below is exhaustive for v1. Every row is a separate AWS operation,
distinguished from siblings by the combination of (verb, path, query). The
`@S3Operation` decorator on the matching dispatch branch sets
`req.openbucket.operation = '<Name>'` so the XML interceptor and logger can
identify it.

### 2.8.1. Service

| Verb | Path | Query | AWS Op | Notes |
|---|---|---|---|---|
| GET | `/` | — | `ListBuckets` | Returns `<ListAllMyBucketsResult>`. Root creds only in v1. |

### 2.8.2. Bucket

| Verb | Path | Query | AWS Op | Notes |
|---|---|---|---|---|
| PUT  | `/:bucket` | — | `CreateBucket` | Body optional; `<CreateBucketConfiguration>` if region declared. |
| DELETE | `/:bucket` | — | `DeleteBucket` | Refuses if non-empty (`BucketNotEmpty`). |
| HEAD | `/:bucket` | — | `HeadBucket` | 200 if exists+authorized, else `NoSuchBucket`. |
| GET  | `/:bucket` | — | `ListObjectsV1` | Legacy. Kept for compatibility. |
| GET  | `/:bucket` | `list-type=2` | `ListObjectsV2` | Default for modern clients. See §2.10. |
| GET  | `/:bucket` | `versions` | `ListObjectVersions` | |
| GET  | `/:bucket` | `uploads` | `ListMultipartUploads` | |
| GET  | `/:bucket` | `location` | `GetBucketLocation` | Returns `us-east-1`. |
| GET  | `/:bucket` | `acl` | `GetBucketAcl` | Single-tenant: always returns owner-full. |
| PUT  | `/:bucket` | `acl` | `PutBucketAcl` | Accepted; no-op beyond owner-full. |
| GET  | `/:bucket` | `policy` | `GetBucketPolicy` | JSON body. |
| PUT  | `/:bucket` | `policy` | `PutBucketPolicy` | JSON body. |
| DELETE | `/:bucket` | `policy` | `DeleteBucketPolicy` | |
| GET  | `/:bucket` | `cors` | `GetBucketCors` | |
| PUT  | `/:bucket` | `cors` | `PutBucketCors` | |
| DELETE | `/:bucket` | `cors` | `DeleteBucketCors` | |
| GET  | `/:bucket` | `versioning` | `GetBucketVersioning` | |
| PUT  | `/:bucket` | `versioning` | `PutBucketVersioning` | Enable / Suspend. |
| GET  | `/:bucket` | `lifecycle` | `GetBucketLifecycleConfiguration` | |
| PUT  | `/:bucket` | `lifecycle` | `PutBucketLifecycleConfiguration` | |
| DELETE | `/:bucket` | `lifecycle` | `DeleteBucketLifecycle` | |
| GET  | `/:bucket` | `tagging` | `GetBucketTagging` | |
| PUT  | `/:bucket` | `tagging` | `PutBucketTagging` | |
| DELETE | `/:bucket` | `tagging` | `DeleteBucketTagging` | |
| GET  | `/:bucket` | `encryption` | `GetBucketEncryption` | |
| PUT  | `/:bucket` | `encryption` | `PutBucketEncryption` | SSE-S3 only in v1. |
| DELETE | `/:bucket` | `encryption` | `DeleteBucketEncryption` | |
| GET  | `/:bucket` | `object-lock` | `GetObjectLockConfiguration` | |
| PUT  | `/:bucket` | `object-lock` | `PutObjectLockConfiguration` | |
| GET  | `/:bucket` | `replication` | `GetBucketReplication` | Returns `ReplicationConfigurationNotFoundError`. |
| GET  | `/:bucket` | `notification` | `GetBucketNotificationConfiguration` | Returns empty doc; PUT is `NotImplemented` in v1. |
| GET  | `/:bucket` | `accelerate` | `GetBucketAccelerateConfiguration` | Returns `Suspended`. |
| GET  | `/:bucket` | `logging` | `GetBucketLogging` | Returns empty doc. |
| GET  | `/:bucket` | `requestPayment` | `GetBucketRequestPayment` | Returns `BucketOwner`. |
| GET  | `/:bucket` | `website` | `GetBucketWebsite` | `NotImplemented`. |
| POST | `/:bucket` | `delete` | `DeleteObjects` | Bulk delete; XML body `<Delete>`. |

### 2.8.3. Object

| Verb | Path | Query | AWS Op | Notes |
|---|---|---|---|---|
| PUT  | `/:bucket/:key+` | — | `PutObject` | Body is the object. |
| PUT  | `/:bucket/:key+` | — (+ `x-amz-copy-source` header) | `CopyObject` | No body. |
| GET  | `/:bucket/:key+` | — | `GetObject` | Honours `Range`, `If-Match`, etc. |
| HEAD | `/:bucket/:key+` | — | `HeadObject` | |
| DELETE | `/:bucket/:key+` | — | `DeleteObject` | Optional `versionId` query. |
| POST | `/:bucket` | — (multipart form) | `PostObject` | Browser-form upload; body is `multipart/form-data`. |
| POST | `/:bucket/:key+` | `restore` | `RestoreObject` | Stub: 200 OK. |
| GET  | `/:bucket/:key+` | `tagging` | `GetObjectTagging` | |
| PUT  | `/:bucket/:key+` | `tagging` | `PutObjectTagging` | |
| DELETE | `/:bucket/:key+` | `tagging` | `DeleteObjectTagging` | |
| GET  | `/:bucket/:key+` | `acl` | `GetObjectAcl` | |
| PUT  | `/:bucket/:key+` | `acl` | `PutObjectAcl` | Accepted; no-op. |
| GET  | `/:bucket/:key+` | `attributes` | `GetObjectAttributes` | |
| GET  | `/:bucket/:key+` | `retention` | `GetObjectRetention` | |
| PUT  | `/:bucket/:key+` | `retention` | `PutObjectRetention` | |
| GET  | `/:bucket/:key+` | `legal-hold` | `GetObjectLegalHold` | |
| PUT  | `/:bucket/:key+` | `legal-hold` | `PutObjectLegalHold` | |
| GET  | `/:bucket/:key+` | `torrent` | `GetObjectTorrent` | `NotImplemented`. |

### 2.8.4. Multipart

| Verb | Path | Query | AWS Op | Notes |
|---|---|---|---|---|
| POST | `/:bucket/:key+` | `uploads` | `CreateMultipartUpload` | Returns `<InitiateMultipartUploadResult>` with `UploadId`. |
| PUT  | `/:bucket/:key+` | `uploadId=…&partNumber=N` | `UploadPart` | Body is the part. |
| PUT  | `/:bucket/:key+` | `uploadId=…&partNumber=N` + `x-amz-copy-source` | `UploadPartCopy` | No body. |
| POST | `/:bucket/:key+` | `uploadId=…` | `CompleteMultipartUpload` | XML body `<CompleteMultipartUpload>`. |
| DELETE | `/:bucket/:key+` | `uploadId=…` | `AbortMultipartUpload` | |
| GET  | `/:bucket/:key+` | `uploadId=…` | `ListParts` | |
| GET  | `/:bucket` | `uploads` | `ListMultipartUploads` | (Also listed under Bucket; same endpoint.) |

### 2.8.5. CORS preflight

| Verb | Path | Query | AWS Op | Notes |
|---|---|---|---|---|
| OPTIONS | `/:bucket/:key*` | — | (preflight) | Synthesised from bucket CORS config. See §2.9. |

---

## 2.9. CORS preflight handling

S3 attaches CORS configuration to *buckets*, not to the service. Preflight
behaviour is therefore per-bucket-rules-driven.

```ts
// apps/backend/src/s3/cors/cors.controller.ts
import {
  Controller,
  Headers,
  Options,
  Req,
  Res,
  UseFilters,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { S3ExceptionFilter } from '../errors/s3-exception.filter';
import { BucketService } from '../../domain/buckets/bucket.service';
import { RouteResolver } from '../routing/route-resolver';
import {
  AccessDeniedError,
  NoSuchBucketError,
  NoSuchCORSConfigurationError,
} from '../errors/s3-error';

@Controller()
@UseFilters(S3ExceptionFilter)
export class CorsController {
  constructor(
    private readonly buckets: BucketService,
    private readonly routes: RouteResolver,
  ) {}

  @Options(':bucketOrKey/*')
  @Options(':bucketOrKey')
  async preflight(@Req() req: Request, @Res() res: Response): Promise<void> {
    const { bucket } = this.routes.resolve(req);
    const origin = req.headers['origin'];
    const method = req.headers['access-control-request-method'] as string | undefined;
    const requestedHeaders =
      (req.headers['access-control-request-headers'] as string | undefined)
        ?.split(',')
        .map((h) => h.trim().toLowerCase()) ?? [];

    if (!origin || !method) {
      // Non-CORS OPTIONS: respond with Allow but no CORS headers.
      res.status(200).setHeader('Allow', 'GET, HEAD, PUT, POST, DELETE, OPTIONS').end();
      return;
    }

    const bucketRow = await this.buckets.find(bucket);
    if (!bucketRow) throw new NoSuchBucketError(bucket);

    const config = bucketRow.corsConfiguration;
    if (!config) throw new NoSuchCORSConfigurationError('CORSResponse: CORS is not enabled for this bucket.');

    const rule = config.rules.find((r) =>
      matchOrigin(r.allowedOrigins, origin) &&
      r.allowedMethods.includes(method.toUpperCase()) &&
      requestedHeaders.every((h) => matchHeader(r.allowedHeaders, h)),
    );
    if (!rule) throw new AccessDeniedError('CORSResponse: This CORS request is not allowed.');

    res.setHeader('Access-Control-Allow-Origin', rule.allowedOrigins.includes('*') ? '*' : origin);
    res.setHeader('Access-Control-Allow-Methods', rule.allowedMethods.join(', '));
    if (rule.allowedHeaders.length) {
      res.setHeader('Access-Control-Allow-Headers', rule.allowedHeaders.join(', '));
    }
    if (rule.exposeHeaders?.length) {
      res.setHeader('Access-Control-Expose-Headers', rule.exposeHeaders.join(', '));
    }
    if (rule.maxAgeSeconds !== undefined) {
      res.setHeader('Access-Control-Max-Age', String(rule.maxAgeSeconds));
    }
    res.setHeader('Vary', 'Origin, Access-Control-Request-Method, Access-Control-Request-Headers');
    res.status(200).end();
  }
}

function matchOrigin(allowed: string[], origin: string): boolean {
  return allowed.some((pattern) => globMatch(pattern, origin));
}
function matchHeader(allowed: string[], header: string): boolean {
  return allowed.some((pattern) => globMatch(pattern.toLowerCase(), header));
}
function globMatch(pattern: string, candidate: string): boolean {
  // AWS supports a single '*' wildcard anywhere in the pattern.
  if (pattern === '*') return true;
  if (!pattern.includes('*')) return pattern === candidate;
  const star = pattern.indexOf('*');
  const head = pattern.slice(0, star);
  const tail = pattern.slice(star + 1);
  return candidate.startsWith(head) && candidate.endsWith(tail);
}
```

OPTIONS bypasses `SigV4Guard` — AWS does not sign preflight requests, and
neither do clients. The classifier middleware sets `req.openbucket.kind =
's3'` for OPTIONS routes that fall through to the bucket prefix, and the
S3 module's controller order places `CorsController` before
`ObjectController` so that the OPTIONS verb is captured here.

---

## 2.10. ListObjectsV2 pagination

S3 returns at most `MaxKeys` (default 1000, cap 1000) objects per call.
Continuation is provided by the server as a `NextContinuationToken` string,
which the client echoes back as `?continuation-token=…` on the next call.
AWS treats the token as opaque; clients only need it to round-trip.

OpenBucket encodes the token as **`base64url(JSON.stringify(cursor))`** with
an HMAC suffix so a token cannot be forged or tampered with. The HMAC is
keyed by a per-process secret derived once at boot — token validity is
guaranteed only for the current process lifetime, which matches S3's
informal contract ("don't store tokens long-term").

```ts
// apps/backend/src/s3/pagination/continuation-token.ts
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

@Injectable()
export class ContinuationToken implements OnModuleInit {
  private secret!: Buffer;

  onModuleInit(): void {
    // Derived at process start. Tokens are valid only within this process,
    // which is fine: every other S3-compatible server makes the same
    // assumption.
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
    const expected = crypto.createHmac('sha256', this.secret).update(payload).digest().subarray(0, 12);
    if (!crypto.timingSafeEqual(mac, expected)) {
      throw new InvalidArgumentError('continuation token failed validation', 'continuation-token', token);
    }
    let cursor: ListCursor;
    try {
      cursor = JSON.parse(payload.toString('utf8')) as ListCursor;
    } catch {
      throw new InvalidArgumentError('malformed continuation token', 'continuation-token', token);
    }
    if (cursor.v !== 1 || cursor.b !== expectedBucket) {
      throw new InvalidArgumentError('continuation token does not belong to this listing', 'continuation-token', token);
    }
    return cursor;
  }
}
```

The handler uses it like this (pseudocode — full implementation belongs to
the persistence agent, who owns the SQL):

```ts
// inside ObjectService.listObjectsV2
const cursor = req.query['continuation-token']
  ? this.tokens.decode(String(req.query['continuation-token']), bucket)
  : null;

const rows = await this.repo.listObjects({
  bucket,
  prefix: cursor?.prefix ?? (req.query.prefix as string) ?? '',
  afterKey: cursor?.afterKey ?? (req.query['start-after'] as string) ?? '',
  delimiter: cursor?.delimiter ?? (req.query.delimiter as string | undefined) ?? null,
  limit: maxKeys + 1,                          // request one extra to detect truncation
});

const truncated = rows.length > maxKeys;
const page = rows.slice(0, maxKeys);
const nextToken = truncated
  ? this.tokens.encode({
      v: 1,
      b: bucket,
      afterKey: page[page.length - 1].key,
      prefix: req.query.prefix as string ?? '',
      delimiter: (req.query.delimiter as string | undefined) ?? null,
    })
  : null;

return {
  __root: 'ListBucketResult',
  Name: bucket,
  Prefix: req.query.prefix ?? '',
  MaxKeys: maxKeys,
  KeyCount: page.length,
  IsTruncated: truncated,
  NextContinuationToken: nextToken ?? undefined,
  Contents: page.map(/* … */),
};
```

`ListObjectsV1` (no `list-type=2`) uses the same machinery but returns
`Marker` / `NextMarker` instead of continuation tokens — those are *not*
HMAC-protected because v1 marker is the last key itself, which clients
already see. v2 hides the cursor's internals behind the token, so the token
must be tamper-proof.
