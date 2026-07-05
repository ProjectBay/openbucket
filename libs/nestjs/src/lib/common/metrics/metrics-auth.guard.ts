import {
  CanActivate,
  ExecutionContext,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';

import { AppConfigService } from '../config/app-config.service';

/**
 * Authorizes a `/metrics` scrape (STORY-1202, TASK-3623) per the configured mode:
 *
 *  - `off`    → deny with `404 NotFound`. The scrape must be indistinguishable
 *               from an unmapped route so no registry body is ever leaked (the
 *               controller is still mapped, but this guard closes it).
 *  - `public` → allow (unauthenticated scrape — the intended default for a
 *               trusted network / an internal Prometheus).
 *  - `token`  → require `Authorization: Bearer <token>` and compare it to the
 *               configured `metricsToken` in CONSTANT time (`timingSafeEqual`,
 *               guarded by a length check since it throws on length mismatch),
 *               returning `401` on any miss.
 *
 * The token value is NEVER put into an exception message or logged — the bearer
 * header is redacted by the existing pino `authorization` redaction path.
 */
@Injectable()
export class MetricsAuthGuard implements CanActivate {
  constructor(private readonly config: AppConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const mode = this.config.metricsMode;
    if (mode === 'off') {
      // Defensive: even though `off` normally means "don't scrape", the route is
      // registered, so we deny here with a 404 rather than leak a metrics body.
      throw new NotFoundException();
    }
    if (mode === 'public') return true;

    // mode === 'token'
    const req = context.switchToHttp().getRequest<Request>();
    const header = req.headers.authorization;
    const expected = this.config.metricsToken ?? '';
    if (!header?.startsWith('Bearer ') || expected.length === 0) {
      throw new UnauthorizedException();
    }
    const provided = header.slice('Bearer '.length).trim();
    if (!constantTimeEqual(provided, expected)) {
      throw new UnauthorizedException();
    }
    return true;
  }
}

/**
 * Constant-time string comparison. `timingSafeEqual` throws when the two buffers
 * differ in length, so a length check gates it — returning `false` on a length
 * mismatch WITHOUT leaking timing about the matched-length prefix.
 */
function constantTimeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}
