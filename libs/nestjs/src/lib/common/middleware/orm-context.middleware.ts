import { Injectable, NestMiddleware } from '@nestjs/common';
import { InjectMikroORM } from '@mikro-orm/nestjs';
import { MikroORM, RequestContext } from '@mikro-orm/core';
import type { NextFunction, Request, Response } from 'express';

import { OPEN_BUCKET_ORM_CONTEXT } from '../../persistence/orm-context';

/**
 * Per-request MikroORM `RequestContext` for OpenBucket's NAMED ORM instance.
 *
 * We disable `@mikro-orm/nestjs`'s auto request-context middleware
 * (`registerRequestContext: false`) because that middleware injects the DEFAULT
 * `MikroORM` token, which a named context does not bind — it would resolve a
 * host's ORM (or nothing) instead of ours. This middleware forks the named EM
 * per request (off the same root EM the repositories are bound to), so
 * request-scoped consumers like `BucketService` (which use
 * `repository.getEntityManager()` without an explicit `.fork()`) get a correct
 * per-request identity map. Mirrors the stock `MikroOrmMiddleware`, but for our
 * context. See [persistence/orm-context.ts].
 */
@Injectable()
export class OrmContextMiddleware implements NestMiddleware {
  constructor(@InjectMikroORM(OPEN_BUCKET_ORM_CONTEXT) private readonly orm: MikroORM) {}

  use(_req: Request, _res: Response, next: NextFunction): void {
    RequestContext.create(this.orm.em, next);
  }
}
