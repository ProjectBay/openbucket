import { Catch, ExceptionFilter, ArgumentsHost, Inject, Optional } from '@nestjs/common';
import type { Request } from 'express';

import { OPEN_BUCKET_OPTIONS, type ResolvedOpenBucketOptions } from '../../open-bucket-options';
import { S3ExceptionFilter } from './s3-exception.filter';
import { AdminExceptionFilter } from './admin-exception.filter';
import { CatchAllExceptionFilter } from './catch-all.filter';

/**
 * The single global exception filter (§1.6.2). NestJS invokes only ONE matching
 * global filter, so the previous design — three catch-all filters that rethrow
 * to "fall through" to the next — never chained: the first one to run rethrew
 * straight to Express, and admin/SPA errors leaked the default HTML page.
 *
 * This dispatcher is the one registered filter. It routes by the classifier's
 * `req.openbucket.kind` to the per-kind renderer (S3 XML, admin JSON, or the
 * last-resort 500), reusing the existing filter classes verbatim.
 *
 * Library isolation (§packaging-2): when embedded under a `mountPath`, a request
 * OUTSIDE the mount is the HOST app's — re-throw so the host's own filters / Nest's
 * default handler render it, instead of leaking OpenBucket's 500 onto host routes.
 * Standalone (`mountPath === ''`) owns every route, so nothing is re-thrown.
 */
@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly s3 = new S3ExceptionFilter();
  private readonly admin = new AdminExceptionFilter();
  private readonly catchAll = new CatchAllExceptionFilter();
  private readonly mountPath: string;

  constructor(@Optional() @Inject(OPEN_BUCKET_OPTIONS) options?: ResolvedOpenBucketOptions) {
    this.mountPath = options?.mountPath ?? '';
  }

  catch(exception: unknown, host: ArgumentsHost): void {
    const req = host.switchToHttp().getRequest<Request>();

    if (this.mountPath && !this.isUnderMount(req.path)) {
      throw exception; // host-owned route — not OpenBucket's to render
    }

    const kind = req.openbucket?.kind;
    if (kind === 's3') return this.s3.catch(exception, host);
    if (kind === 'admin') return this.admin.catch(exception, host);

    // 'spa' or an unclassified request → last-resort 500.
    return this.catchAll.catch(exception, host);
  }

  private isUnderMount(path: string): boolean {
    return path === this.mountPath || path.startsWith(`${this.mountPath}/`);
  }
}
