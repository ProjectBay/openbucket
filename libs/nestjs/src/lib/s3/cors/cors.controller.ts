import { Controller, Options, Req, Res, UseFilters } from '@nestjs/common';
import type { Request, Response } from 'express';

import { BucketService } from '../../domain/buckets/bucket.service';
import { AccessDeniedError } from '../errors/s3-error';
import { S3ExceptionFilter } from '../errors/s3-exception.filter';
import { RouteResolver } from '../routing/route-resolver';

/**
 * CORS preflight (WHITEPAPER §2.9). Browsers send an unsigned `OPTIONS` before a
 * cross-origin fetch; S3 answers it from the *bucket's* stored CORS rules, not
 * the service. This controller is mounted before `ObjectController` in
 * `S3Module` so the OPTIONS verb is captured here, and it omits `SigV4Guard`
 * (AWS does not sign preflights — §2.9). The `(bucket, key)` pair comes from the
 * classifier via `RouteResolver`, so the route param names are decorative.
 */
@Controller(':bucket')
@UseFilters(S3ExceptionFilter)
export class CorsController {
  constructor(
    private readonly buckets: BucketService,
    private readonly routes: RouteResolver,
  ) {}

  /** `OPTIONS /:bucket` — bucket-scope preflight. */
  @Options()
  bucketPreflight(@Req() req: Request, @Res() res: Response): Promise<void> {
    return this.preflight(req, res);
  }

  /** `OPTIONS /:bucket/<key>` — object-scope preflight. */
  @Options('*')
  objectPreflight(@Req() req: Request, @Res() res: Response): Promise<void> {
    return this.preflight(req, res);
  }

  private async preflight(req: Request, res: Response): Promise<void> {
    const { bucket } = this.routes.resolve(req);
    const origin = req.headers['origin'];
    const method = req.headers['access-control-request-method'] as string | undefined;
    const requestedHeaders =
      (req.headers['access-control-request-headers'] as string | undefined)
        ?.split(',')
        .map((h) => h.trim().toLowerCase())
        .filter((h) => h.length > 0) ?? [];

    if (!origin || !method) {
      // Non-CORS OPTIONS: respond with Allow but no CORS headers.
      res.status(200).setHeader('Allow', 'GET, HEAD, PUT, POST, DELETE, OPTIONS').end();
      return;
    }

    // Uniform outcome for every non-matching case (TASK-2112, CWE-203): a
    // missing bucket, an existing bucket with no CORS config, and an existing
    // bucket whose rules don't match all collapse to one opaque 403 AccessDenied.
    // Distinct NoSuchBucket / NoSuchCORSConfiguration codes here would let an
    // anonymous caller (preflights are unsigned) diff the responses to enumerate
    // which bucket names exist. Only a genuine rule match yields 200 + ACAO,
    // which reveals existence solely for a bucket whose owner deliberately
    // published a matching public CORS rule.
    const rule = (await this.buckets.findByName(bucket))?.cors?.find(
      (r) =>
        matchOrigin(r.allowedOrigins, origin) &&
        (r.allowedMethods as readonly string[]).includes(method.toUpperCase()) &&
        requestedHeaders.every((h) => matchHeader(r.allowedHeaders ?? [], h)),
    );
    if (!rule) throw new AccessDeniedError('CORSResponse: This CORS request is not allowed.');

    res.setHeader('Access-Control-Allow-Origin', rule.allowedOrigins.includes('*') ? '*' : origin);
    res.setHeader('Access-Control-Allow-Methods', rule.allowedMethods.join(', '));
    if (rule.allowedHeaders?.length) {
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

/** True if `origin` matches any allowed-origin pattern (single-`*` glob). */
export function matchOrigin(allowed: string[], origin: string): boolean {
  return allowed.some((pattern) => globMatch(pattern, origin));
}

/** True if a (lower-cased) requested `header` matches any allowed-header pattern. */
export function matchHeader(allowed: string[], header: string): boolean {
  return allowed.some((pattern) => globMatch(pattern.toLowerCase(), header));
}

/** AWS CORS glob: a single `*` wildcard anywhere in the pattern. */
export function globMatch(pattern: string, candidate: string): boolean {
  if (pattern === '*') return true;
  if (!pattern.includes('*')) return pattern === candidate;
  const star = pattern.indexOf('*');
  const head = pattern.slice(0, star);
  const tail = pattern.slice(star + 1);
  return candidate.startsWith(head) && candidate.endsWith(tail);
}
