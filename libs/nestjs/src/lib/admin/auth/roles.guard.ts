import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  Optional,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';

import { OPEN_BUCKET_OPTIONS, type ResolvedOpenBucketOptions } from '../../open-bucket-options';
import { ALLOW_READONLY_KEY } from './allow-readonly.decorator';
import type { AdminJwtPayload } from './jwt-auth.guard';

/** HTTP methods treated as state-changing (default-denied for read-only admins). */
const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Role enforcement (EPIC-11, STORY-1002), bound as the second global `APP_GUARD`
 * immediately after {@link JwtAuthGuard} so `req.user.role` is already the fresh
 * DB value when this runs. Model is DEFAULT-DENY BY METHOD: a `readonly`
 * principal is 403'd on every mutating admin route, so a newly-added mutating
 * route is read-only-safe without remembering a decorator. Reads always pass; the
 * `@AllowReadOnly()` decorator and a small self-service allowlist are the only
 * escape hatches. Full admins pass everything.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  /** Admin API prefix, mount-aware + lower-cased — identical to JwtAuthGuard. */
  private readonly adminPrefix: string;

  /**
   * Self-service sub-paths (relative to {@link adminPrefix}, lower-cased) a
   * read-only admin must still be able to POST to — mirror of
   * `JwtAuthGuard.FORCED_ROTATION_ALLOWLIST` minus the reads: change your own
   * password, log yourself out. Everything else mutating is denied.
   */
  private static readonly READONLY_ALLOWLIST = new Set([
    'settings/change-password',
    'auth/logout',
  ]);

  constructor(
    private readonly reflector: Reflector,
    @Optional() @Inject(OPEN_BUCKET_OPTIONS) options?: ResolvedOpenBucketOptions,
  ) {
    // Lower-cased for a case-INSENSITIVE prefix test (Express routes
    // case-insensitively) — a case-sensitive check would fail OPEN (CWE-178),
    // exactly as documented in JwtAuthGuard.
    this.adminPrefix = `${options?.mountPath ?? ''}/api/admin/`.toLowerCase();
  }

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();

    // 1. Only gate the admin API — S3 + SPA safety net, identical to JwtAuthGuard.
    if (!req.path.toLowerCase().startsWith(this.adminPrefix)) return true;

    // 2. Reads are always allowed.
    if (!MUTATING.has(req.method.toUpperCase())) return true;

    // 3. No principal ⇒ a @Public() mutating route (login/refresh); auth, not
    //    role, gates those and JwtAuthGuard intentionally left `req.user` unset.
    const principal = (req as Request & { user?: AdminJwtPayload }).user;
    if (!principal) return true;

    // 4. Full admin passes everything.
    if (principal.role !== 'readonly') return true;

    // 5. Read-only: allow only via the @AllowReadOnly() opt-in or the
    //    self-service allowlist; otherwise default-deny.
    const allowed = this.reflector.getAllAndOverride<boolean>(ALLOW_READONLY_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (allowed) return true;

    const subPath = req.path.toLowerCase().slice(this.adminPrefix.length);
    if (RolesGuard.READONLY_ALLOWLIST.has(subPath)) return true;

    throw new ForbiddenException('read-only admin cannot perform this action');
  }
}
