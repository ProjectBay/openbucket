import { Inject, Injectable, NestMiddleware, Optional } from '@nestjs/common';
import type { Request, Response, NextFunction } from 'express';

import { AppConfigService } from '../config/app-config.service';
import { OPEN_BUCKET_OPTIONS, type ResolvedOpenBucketOptions } from '../../open-bucket-options';

/**
 * RFC-3986-safe bucket label: 3-63 chars, lowercase alphanumerics and hyphens.
 * Mirrors AWS rules tightly enough for routing; the bucket service does the
 * stricter check (no consecutive dots, no IPv4 shape, etc.) [see §3].
 */
const BUCKET_LABEL = /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/;

@Injectable()
export class RequestClassifierMiddleware implements NestMiddleware {
  private readonly endpointSuffix: string | null;
  /** Host mountPath (e.g. `/storage`), or '' standalone. Stripped before classifying. */
  private readonly mountPath: string;

  constructor(
    config: AppConfigService,
    @Optional() @Inject(OPEN_BUCKET_OPTIONS) options?: ResolvedOpenBucketOptions,
  ) {
    // Stored once; the classifier hot path never touches ConfigService.
    this.endpointSuffix = config.endpoint ? `.${config.endpoint.toLowerCase()}` : null;
    this.mountPath = options?.mountPath ?? '';
  }

  use(req: Request, _res: Response, next: NextFunction): void {
    const ctx = req.openbucket; // RequestIdMiddleware created this skeleton
    ctx.receivedAt = Date.now();

    // Classify on the path RELATIVE to the host mountPath, so the `/api/admin/`,
    // `/admin/`, and path-style S3 prefixes match under a mount (e.g. a host's
    // `/storage/api/admin/*` must classify as `admin`, not S3 — the SigV4 guard
    // and JWT guard both read `ctx.kind`). Requests outside the mount keep the
    // existing fall-through (host routes are never processed by S3/admin).
    let path = req.path; // Express has already stripped query string
    if (this.mountPath && (path === this.mountPath || path.startsWith(`${this.mountPath}/`))) {
      path = path.slice(this.mountPath.length) || '/';
    }
    const host = stripPort((req.headers.host ?? '').toLowerCase());

    // 1. /api/admin/* → admin API. Checked before /admin/ because it's the longer prefix.
    if (path === '/api/admin' || path.startsWith('/api/admin/')) {
      ctx.kind = 'admin';
      return next();
    }

    // 2. /admin/* → SPA. The ServeStaticModule will serve index.html for unknown subpaths.
    if (path === '/admin' || path.startsWith('/admin/')) {
      ctx.kind = 'spa';
      return next();
    }

    // 3. Virtual-host S3.
    if (this.endpointSuffix && host.endsWith(this.endpointSuffix)) {
      const label = host.slice(0, -this.endpointSuffix.length);
      if (label.length > 0 && BUCKET_LABEL.test(label)) {
        ctx.kind = 's3';
        ctx.addressingStyle = 'virtual-host';
        ctx.bucket = label;
        ctx.key = decodeKey(path.slice(1)); // drop leading '/'
        ctx.s3Scope = ctx.key === '' ? 's3-bucket' : 's3-object';
        return next();
      }
      // Looked like vhost but the label is malformed. Fall through to path style;
      // the S3 controller will produce the proper InvalidBucketName error.
    }

    // 4. Path-style S3 (default for everything else, including `/`).
    ctx.kind = 's3';
    ctx.addressingStyle = 'path';
    const [, first = '', ...rest] = path.split('/');
    if (first === '') {
      ctx.s3Scope = 's3-service'; // GET / → ListBuckets
    } else {
      ctx.bucket = first;
      const tail = rest.join('/');
      ctx.key = decodeKey(tail);
      ctx.s3Scope = tail === '' ? 's3-bucket' : 's3-object';
    }
    return next();
  }
}

// Exported for unit testing (TEST-0007 cases 11-13); not part of the public API.
export function stripPort(host: string): string {
  // IPv6 hosts are bracketed: [::1]:9000
  if (host.startsWith('[')) {
    const end = host.indexOf(']');
    return end === -1 ? host : host.slice(0, end + 1);
  }
  const colon = host.indexOf(':');
  return colon === -1 ? host : host.slice(0, colon);
}

export function decodeKey(pathSegment: string): string {
  try {
    return decodeURIComponent(pathSegment);
  } catch {
    // Malformed percent-encoding. Return raw; the S3 controller surfaces InvalidURI.
    return pathSegment;
  }
}
