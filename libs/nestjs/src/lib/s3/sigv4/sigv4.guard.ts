import { CanActivate, ExecutionContext, Injectable, NotFoundException } from '@nestjs/common';
import type { Request } from 'express';

import {
  AccessDeniedError,
  InvalidArgumentError,
  RequestTimeTooSkewedError,
  SignatureDoesNotMatchError,
} from '../errors/s3-error';
import { isPostObjectForm } from '../routing/operation-resolver';
import { KeyService } from './key.service';
import { verifyPresigned } from './presigned';
import { assertMandatorySignedHeaders } from './signed-headers';
import { Sigv4Verifier } from './sigv4.verifier';

const MAX_SKEW_MS = 15 * 60 * 1000; // AWS default ±15 minutes.
const STREAMING_SHA = 'STREAMING-AWS4-HMAC-SHA256-PAYLOAD';
// Signed trailing-checksum chunked upload — not implemented (the unsigned
// trailer form is handled in the interceptor/decoder, STORY-0120).
const STREAMING_TRAILER = 'STREAMING-AWS4-HMAC-SHA256-PAYLOAD-TRAILER';

/**
 * SigV4Guard — header-based SigV4 verification (WHITEPAPER §2.4.3).
 *
 * Rejects chunked-payload signing (§2.4.6), reverse-verifies header-signed
 * requests against the `KeyService`-resolved secret, and stamps the resolved
 * `accessKeyId` onto `req.openbucket`. The presigned-URL branch lands in
 * STORY-0104 (`verifyPresigned`).
 */
@Injectable()
export class SigV4Guard implements CanActivate {
  constructor(
    private readonly keys: KeyService,
    private readonly verifier: Sigv4Verifier,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<Request>();

    // Greedy S3 routes (`:bucket` / `:bucket/*`) can match non-S3 paths the
    // classifier already tagged otherwise (e.g. `/api/admin/*` when TestModule
    // is unmounted, `/admin/*` with no SPA build). Return a clean 404 rather
    // than a misleading 403 from SigV4. (Preserved from the STORY-0100 stub.)
    if (req.openbucket?.kind !== 's3') {
      throw new NotFoundException();
    }

    // Browser POST-policy upload (STORY-0802): authentication lives in the form
    // body (POST policy + signature), not in a header/query signature. Defer the
    // SigV4 check to `PostObjectInterceptor`, which is the fail-closed auth for
    // this one shape (verifies the signature + policy over the streamed body and
    // rejects with a generic SignatureDoesNotMatch on any mismatch). Kept tightly
    // scoped to `POST` + bucket-scope + `multipart/form-data` + no `?delete`; every
    // other request still flows through checkHeader/checkPresigned (no bypass).
    if (isPostObjectForm(req)) {
      return true;
    }

    // Chunked-upload signing: STREAMING-AWS4-HMAC-SHA256-PAYLOAD (signed chunks,
    // STORY-0119) and STREAMING-UNSIGNED-PAYLOAD-TRAILER (unsigned chunks + a
    // trailing checksum, the aws-cli v2 default, STORY-0120) are accepted — the
    // seed signature is verified like any header-signed request and the framing
    // is handled downstream by ChunkedDecoder. The *signed* trailer form
    // (STREAMING-AWS4-HMAC-SHA256-PAYLOAD-TRAILER) additionally signs the
    // trailer and is not implemented yet.
    const contentSha = (req.headers['x-amz-content-sha256'] as string | undefined) ?? '';
    if (contentSha === STREAMING_TRAILER) {
      throw new InvalidArgumentError(
        `${contentSha} (signed trailing-checksum chunked upload) is not supported. ` +
          'Use STREAMING-UNSIGNED-PAYLOAD-TRAILER or UNSIGNED-PAYLOAD.',
        'x-amz-content-sha256',
        contentSha,
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
    // Reject a signature that leaves `host` (or a wire-present x-amz-* header)
    // out of SignedHeaders, so those headers cannot be left unbound (TASK-2121).
    assertMandatorySignedHeaders(parsed.signedHeaders, req.headers);
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

    req.openbucket.accessKeyId = parsed.accessKeyId;

    // Chunked upload: stash the verified seed + signing key so the
    // ChunkedDecoder can verify the per-chunk signature chain (STORY-0119).
    if (req.headers['x-amz-content-sha256'] === STREAMING_SHA) {
      req.openbucket.chunkSigning = {
        signingKey: this.verifier.deriveSigningKey(key.secretAccessKey, parsed.credentialScope),
        seedSignature: parsed.signature,
        amzDate,
        credentialScope: parsed.credentialScope,
      };
    }
    return true;
  }

  // -------- Presigned (§2.5) -------------------------------------------
  private async checkPresigned(req: Request): Promise<boolean> {
    const ok = await verifyPresigned(req, this.keys, this.verifier);
    if (!ok) throw new SignatureDoesNotMatchError();
    return true;
  }

  // -------- Helpers ----------------------------------------------------
  private parseAuthorization(authz: string): {
    accessKeyId: string;
    credentialScope: string; // e.g. 20260520/us-east-1/s3/aws4_request
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
      Number(m[1]),
      Number(m[2]) - 1,
      Number(m[3]),
      Number(m[4]),
      Number(m[5]),
      Number(m[6]),
    );
    if (Math.abs(Date.now() - t) > MAX_SKEW_MS) {
      throw new RequestTimeTooSkewedError(t);
    }
  }
}
