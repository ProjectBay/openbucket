import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  Optional,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';

import { IS_PUBLIC_KEY } from '../../common/auth/public.decorator';
import { OPEN_BUCKET_OPTIONS, type ResolvedOpenBucketOptions } from '../../open-bucket-options';

/** The decoded admin access token attached to `req.user` on success (§5.3). */
export interface AdminJwtPayload {
  sub: string;
  username: string;
  mustChangePassword: boolean;
  iat: number;
  exp: number;
}

/**
 * Global admin auth guard (§5.3), bound as `APP_GUARD` by AdminModule. It
 * authenticates every `/api/admin/*` request unless the handler/class is
 * `@Public()`. The leading path check is the safety net: S3 and SPA trees (which
 * share the global guard) must never be 401'd by it.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  /** Admin API prefix, mount-aware: `<mountPath>/api/admin/` (e.g. `/storage/api/admin/`). */
  private readonly adminPrefix: string;

  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    @Optional() @Inject(OPEN_BUCKET_OPTIONS) options?: ResolvedOpenBucketOptions,
  ) {
    this.adminPrefix = `${options?.mountPath ?? ''}/api/admin/`;
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();

    // Only protect the admin API. Everything else (S3, the /admin SPA, and the
    // host app's own routes when mounted) passes. CRITICAL: under a mountPath the
    // admin routes are `<mountPath>/api/admin/*`, so this prefix is mount-aware —
    // a hardcoded `/api/admin/` would leave the mounted admin API UNGUARDED.
    if (!req.path.startsWith(this.adminPrefix)) return true;

    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      throw new UnauthorizedException('missing bearer');
    }

    const token = header.slice('Bearer '.length).trim();
    try {
      const payload = await this.jwt.verifyAsync<AdminJwtPayload>(token, {
        issuer: 'openbucket',
        audience: 'openbucket-admin',
      });
      (req as Request & { user?: AdminJwtPayload }).user = payload;
      return true;
    } catch {
      throw new UnauthorizedException('invalid token');
    }
  }
}
