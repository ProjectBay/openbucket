import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import busboy from 'busboy';
import type { IncomingMessage } from 'node:http';
import { from, mergeMap, Observable } from 'rxjs';

import { AppConfigService } from '../../common/config/app-config.service';
import {
  AccessDeniedError,
  IncompleteBodyError,
  InvalidArgumentError,
  MalformedPOSTRequestError,
  SignatureDoesNotMatchError,
} from '../errors/s3-error';
import { isPostObjectForm, type PostObjectShapeRequest } from '../routing/operation-resolver';
import { KeyService } from '../sigv4/key.service';
import {
  accessKeyIdFromCredential,
  evaluatePostPolicy,
  parsePostPolicy,
  policyContentLengthRange,
  scopeFromCredential,
  verifyPostSignature,
  type PostPolicy,
} from '../sigv4/presigned-post';
import { createBodyVerifier } from './body-verifier';

/** Resolved PostObject request context the handler ([TASK-2423]) consumes. */
export interface PostObjectContext {
  bucket: string;
  key: string;
  accessKeyId: string;
  contentType?: string;
  successAction: { status?: string; redirect?: string };
}

declare module 'http' {
  interface IncomingMessage {
    /** Populated by PostObjectInterceptor for the bucket-scope POST handler. */
    openbucketPost?: PostObjectContext;
  }
}

// 256 KB highWaterMark (§4.7) — matches the PUT verifier so the write path has
// identical backpressure characteristics.
const HIGH_WATER_MARK = 256 * 1024;

/**
 * Busboy hard limits (CWE-400 / CWE-770). A browser POST-policy upload carries a
 * handful of small text fields + exactly one file; anything beyond these bounds
 * is a malformed/abusive request.
 */
const BUSBOY_LIMITS = {
  files: 1,
  fields: 20,
  fieldSize: 8 * 1024, // bound `policy` (and every field) before JSON.parse
  fieldNameSize: 128,
  parts: 25,
} as const;

/** Sanitise the browser-supplied filename before `${filename}` substitution. */
function safeFilename(filename: string | undefined): string {
  const base = (filename ?? '').replace(/^.*[\\/]/, ''); // strip any path
  if (base === '' || base === '.' || base === '..' || base.includes('..')) {
    throw new MalformedPOSTRequestError('The file name in the upload is not valid.');
  }
  return base;
}

/**
 * PostObjectInterceptor — the streaming browser-form upload verifier (WHITEPAPER
 * §2.5.1). The POST-flow analogue of {@link PutObjectInterceptor}: it
 * streaming-parses `multipart/form-data` with busboy under hard DoS limits,
 * authenticates the request against the submitted POST policy + signature (the
 * ONLY auth on this route — no Authorization/cookie/JWT fallback), and produces a
 * verified, size-capped `Readable` on `req.openbucketPutCtx` for the handler to
 * persist through the same two-phase writer. It reuses the shared body-verifier
 * so the write path is identical to PutObject.
 *
 * `next.handle()` is deferred behind a `ready` promise that settles only once the
 * `file` part has been authenticated + its policy evaluated and the verified
 * stream is piped — so the handler always sees a populated `openbucketPutCtx`
 * (busboy emits `file` asynchronously, unlike PutObject's synchronous req body).
 */
@Injectable()
export class PostObjectInterceptor implements NestInterceptor {
  /** Idle-stall window (TASK-2111, CWE-400) — mirrors PutObjectInterceptor. */
  static readonly STALL_TIMEOUT_MS = 30_000;

  constructor(
    private readonly config: AppConfigService,
    private readonly keys: KeyService,
  ) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = ctx.switchToHttp().getRequest<IncomingMessage>();
    if (!isPostObjectForm(req as unknown as PostObjectShapeRequest)) return next.handle();

    const routeBucket =
      (req as unknown as { openbucket?: { bucket?: string } }).openbucket?.bucket ?? '';

    let settled = false;
    let readyResolve!: () => void;
    let readyReject!: (err: unknown) => void;
    const ready = new Promise<void>((res, rej) => {
      readyResolve = res;
      readyReject = rej;
    });

    let bb: busboy.Busboy;
    try {
      bb = busboy({ headers: req.headers, limits: { ...BUSBOY_LIMITS } });
    } catch {
      // A missing/invalid multipart boundary — reject before any parsing.
      throw new MalformedPOSTRequestError();
    }

    const fields: Record<string, string> = {};
    let fileSeen = false;
    let pendingReject: ((err: unknown) => void) | undefined;

    const fail = (err: unknown): void => {
      if (settled) return;
      settled = true;
      // Reject the deferred handler + any pending verifier promise so the error
      // renders as an S3 XML response via the exception filter. Do NOT destroy
      // the request socket — that would prevent the error response from flushing
      // ("socket hang up"). Stop feeding busboy and drain the rest of the body so
      // the connection can send the response. (The stall watchdog owns the only
      // hard socket teardown, for a genuinely hung upload.)
      pendingReject?.(err);
      readyReject(err);
      req.unpipe?.(bb);
      bb.destroy();
      req.resume?.();
    };

    bb.on('field', (name: string, value: string, info: busboy.FieldInfo) => {
      if (fileSeen) return; // per S3 the file part must be last; ignore trailers
      if (info?.nameTruncated || info?.valueTruncated) {
        return fail(new MalformedPOSTRequestError('A form field exceeded the allowed size.'));
      }
      fields[name] = value;
    });

    bb.on('file', (_name: string, stream: NodeJS.ReadableStream, info: busboy.FileInfo) => {
      if (fileSeen || settled) {
        stream.resume(); // only the first file part is honoured (limits.files=1 too)
        return;
      }
      fileSeen = true;
      this.handleFile(req, fields, routeBucket, stream, info, {
        setReject: (rej) => (pendingReject = rej),
        resolve: () => {
          if (!settled) readyResolve();
        },
        fail,
      });
    });

    bb.on('filesLimit', () => fail(new MalformedPOSTRequestError('Only one file part is allowed.')));
    bb.on('fieldsLimit', () => fail(new MalformedPOSTRequestError('Too many form fields.')));
    bb.on('partsLimit', () => fail(new MalformedPOSTRequestError('Too many form parts.')));
    bb.on('error', (err: unknown) => fail(err));
    bb.on('close', () => {
      if (!fileSeen && !settled) {
        fail(new MalformedPOSTRequestError('The POST request is missing the file part.'));
      }
    });

    // Authentication lives in the body — never fall back to ambient creds. Tear
    // down on client abort/error (same posture as PutObject).
    req.on('error', fail);
    req.on('aborted', () => fail(new IncompleteBodyError('Client aborted the request')));

    // Per-request stall watchdog via the SOCKET timeout (never a `data` listener,
    // which would defeat pull-based backpressure — TEST-0316).
    const timed = req as unknown as { setTimeout?: (ms: number, cb: () => void) => unknown };
    timed.setTimeout?.(PostObjectInterceptor.STALL_TIMEOUT_MS, () => {
      req.destroy(new IncompleteBodyError('upload stalled: no bytes received within the idle window'));
    });

    req.pipe(bb);

    // Defer the handler until the verified stream + context are ready.
    return from(ready).pipe(mergeMap(() => next.handle()));
  }

  /**
   * Handle the `file` part: substitute `${filename}`, authenticate the policy +
   * signature, evaluate the non-length conditions, then pipe the file through the
   * shared size-capped verifier and stamp `req.openbucketPutCtx` +
   * `req.openbucketPost`. Resolves `hooks.resolve()` once the stream is live.
   */
  private handleFile(
    req: IncomingMessage,
    fields: Record<string, string>,
    routeBucket: string,
    fileStream: NodeJS.ReadableStream,
    info: busboy.FileInfo,
    hooks: {
      setReject: (rej: (err: unknown) => void) => void;
      resolve: () => void;
      fail: (err: unknown) => void;
    },
  ): void {
    let key: string;
    let accessKeyId: string;
    let policy: PostPolicy;
    try {
      const rawKey = fields['key'];
      if (typeof rawKey !== 'string' || rawKey.length === 0) {
        throw new InvalidArgumentError('The key form field is required.', 'key');
      }
      // 1. ${filename} substitution (S3 semantics), with a sanitised base name.
      key = rawKey.includes('${filename}')
        ? rawKey.replace(/\$\{filename\}/g, safeFilename(info?.filename))
        : rawKey;
      fields['key'] = key;

      // 2. Validate the algorithm + credential scope, parse the policy.
      if (fields['x-amz-algorithm'] !== 'AWS4-HMAC-SHA256') {
        throw new InvalidArgumentError(
          'unsupported algorithm',
          'x-amz-algorithm',
          fields['x-amz-algorithm'] ?? '',
        );
      }
      policy = parsePostPolicy(fields['policy']);
      const akid = accessKeyIdFromCredential(fields['x-amz-credential']);
      if (!akid || !scopeFromCredential(fields['x-amz-credential'])) {
        throw new AccessDeniedError('unexpected credential scope');
      }
      accessKeyId = akid;
    } catch (err) {
      fileStream.resume();
      hooks.fail(err);
      return;
    }

    // 3. Build the verified stream + context synchronously so it exists the moment
    //    `ready` resolves. Length is capped on streamed bytes only — never the
    //    multipart Content-Length envelope.
    const range = policyContentLengthRange(policy);
    const configMax = this.config.maxObjectSizeMb * 1024 * 1024;
    const maxBytes = range ? Math.min(range.max, configMax) : configMax;
    const { verifier, hashes, size, rejectPending } = createBodyVerifier({
      maxBytes,
      minBytes: range?.min,
      highWaterMark: HIGH_WATER_MARK,
    });
    hooks.setReject(rejectPending);
    verifier.on('error', (err) => rejectPending(err));
    hashes.catch(() => undefined);
    size.catch(() => undefined);
    fileStream.on('error', (err) => rejectPending(err));

    req.openbucketPutCtx = { stream: verifier, hashes, size };
    req.openbucketPost = {
      bucket: routeBucket,
      key,
      accessKeyId,
      contentType: fields['Content-Type'] ?? info?.mimeType,
      successAction: {
        status: fields['success_action_status'],
        redirect: fields['success_action_redirect'],
      },
    };
    (req as unknown as { openbucket: { accessKeyId?: string } }).openbucket.accessKeyId = accessKeyId;

    // 4. Resolve the secret + verify the signature + evaluate conditions, then
    //    start streaming. A generic error on absent/mismatched key so we never
    //    leak whether the access-key exists.
    void this.authenticate(fields, routeBucket, accessKeyId, policy)
      .then(() => {
        // `hooks.resolve()` no-ops if the request already failed/aborted
        // (settled), so a clean async gap never resurrects a torn-down request.
        fileStream.pipe(verifier);
        hooks.resolve();
      })
      .catch((err) => {
        fileStream.resume();
        rejectPending(err);
        verifier.destroy(err as Error);
        hooks.fail(err);
      });
  }

  private async authenticate(
    fields: Record<string, string>,
    routeBucket: string,
    accessKeyId: string,
    policy: PostPolicy,
  ): Promise<void> {
    const secret = await this.keys.getSecret(accessKeyId);
    if (!secret || !verifyPostSignature(fields, secret.secretAccessKey)) {
      throw new SignatureDoesNotMatchError();
    }
    // Evaluate the non-length conditions up front (length enforced on the wire by
    // the verifier min/max). Fail-closed on any uncovered field.
    evaluatePostPolicy(policy, fields, routeBucket);
  }
}
