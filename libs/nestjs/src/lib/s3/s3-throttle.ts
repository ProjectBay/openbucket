import { SetMetadata, type ExecutionContext } from '@nestjs/common';

/**
 * Rate limiting for the S3 data plane (TASK-2141, CWE-770).
 *
 * `ThrottlerGuard` runs every configured named throttler on every request unless
 * that throttler is skipped for the route. Binding the guard app-wide would
 * otherwise apply the admin `login` (5/min) and `default` (100/min) buckets to
 * high-throughput S3 traffic and break legitimate clients. To keep the buckets
 * mutually exclusive we tag the S3 controllers with {@link S3Throttled} and route
 * each throttler with a `skipIf` predicate:
 *
 *   - `s3`      → applies ONLY to `@S3Throttled` controllers (a wide, configurable
 *                 per-IP bucket).
 *   - `default` → applies everywhere EXCEPT the S3 controllers (admin 100/min).
 *   - `login`   → applies ONLY to the login route, unchanged from before.
 */
const S3_THROTTLED = Symbol('openbucket:s3-throttled');

/** Suffix of the admin login route path (mount-prefix agnostic). */
const LOGIN_ROUTE_SUFFIX = '/api/admin/auth/login';

/** Class decorator marking a controller as part of the throttled S3 surface. */
export const S3Throttled = (): ClassDecorator => SetMetadata(S3_THROTTLED, true);

/** True when the handled route belongs to an `@S3Throttled` controller. */
export function isS3ThrottledRoute(ctx: ExecutionContext): boolean {
  return (
    Reflect.getMetadata(S3_THROTTLED, ctx.getClass()) === true ||
    Reflect.getMetadata(S3_THROTTLED, ctx.getHandler()) === true
  );
}

/**
 * True for the admin login route (`POST <mountPath>/api/admin/auth/login`).
 * Path-based so the check needs no coupling to the throttler's internal metadata
 * keys, and mount-prefix agnostic (library mode prefixes `mountPath`).
 */
export function isLoginRoute(ctx: ExecutionContext): boolean {
  const req = ctx.switchToHttp().getRequest<{ method?: string; originalUrl?: string; url?: string }>();
  const path = (req.originalUrl ?? req.url ?? '').split('?', 1)[0];
  return (req.method ?? '').toUpperCase() === 'POST' && path.endsWith(LOGIN_ROUTE_SUFFIX);
}
