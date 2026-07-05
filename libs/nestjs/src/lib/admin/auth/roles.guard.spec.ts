import { ForbiddenException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';

import { RolesGuard } from './roles.guard';

/**
 * TASK-3021 / [TEST-1002] cases 3–7 — RolesGuard: default-deny mutating admin
 * routes for read-only principals, with the @AllowReadOnly opt-in and the
 * self-service allowlist as the only escape hatches. Full admins pass; reads and
 * non-admin/@Public routes always pass. Authorization is read off `req.user.role`
 * which JwtAuthGuard has already refreshed from the live DB.
 */
const handler = (): void => undefined;
class HandlerClass {}

function context(req: Record<string, unknown>): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => req }),
    getHandler: () => handler,
    getClass: () => HandlerClass,
  } as unknown as ExecutionContext;
}

function build(allowReadOnly = false) {
  const reflector = { getAllAndOverride: jest.fn().mockReturnValue(allowReadOnly) };
  const guard = new RolesGuard(reflector as unknown as Reflector);
  return { guard, reflector };
}

function req(method: string, path: string, role?: 'admin' | 'readonly') {
  return { method, path, user: role ? { role } : undefined };
}

describe('RolesGuard (TASK-3021)', () => {
  it('non-admin paths (S3/SPA) always pass, even for a read-only mutation', () => {
    const { guard } = build();
    expect(guard.canActivate(context(req('DELETE', '/api/s3/bucket/key', 'readonly')))).toBe(true);
    expect(guard.canActivate(context(req('POST', '/admin/login', 'readonly')))).toBe(true);
  });

  it('reads (GET/HEAD) always pass for a read-only admin', () => {
    const { guard } = build();
    expect(guard.canActivate(context(req('GET', '/api/admin/users', 'readonly')))).toBe(true);
    expect(guard.canActivate(context(req('HEAD', '/api/admin/buckets', 'readonly')))).toBe(true);
  });

  it('a @Public mutating route with no principal passes (auth, not role, gates it)', () => {
    const { guard } = build();
    expect(guard.canActivate(context(req('POST', '/api/admin/auth/login')))).toBe(true);
    expect(guard.canActivate(context(req('POST', '/api/admin/auth/refresh')))).toBe(true);
  });

  it('a full admin passes every mutating route', () => {
    const { guard } = build();
    for (const m of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      expect(guard.canActivate(context(req(m, '/api/admin/users/bob', 'admin')))).toBe(true);
    }
  });

  it('a read-only admin is 403d on DELETE/POST/PATCH admin routes', () => {
    const { guard } = build();
    for (const m of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      expect(() => guard.canActivate(context(req(m, '/api/admin/users/bob', 'readonly')))).toThrow(
        ForbiddenException,
      );
    }
  });

  it('a read-only admin may still POST the self-service allowlist routes', () => {
    const { guard } = build();
    expect(
      guard.canActivate(context(req('POST', '/api/admin/settings/change-password', 'readonly'))),
    ).toBe(true);
    expect(guard.canActivate(context(req('POST', '/api/admin/auth/logout', 'readonly')))).toBe(true);
  });

  it('@AllowReadOnly() opts a mutating route out of the deny for a read-only admin', () => {
    const { guard } = build(true);
    expect(guard.canActivate(context(req('POST', '/api/admin/anything', 'readonly')))).toBe(true);
  });

  it('the prefix + method match is case-insensitive (no CWE-178 fail-open)', () => {
    const { guard } = build();
    // Upper-cased path AND method must still be denied for a read-only admin.
    expect(() =>
      guard.canActivate(context(req('delete', '/API/ADMIN/USERS/bob', 'readonly'))),
    ).toThrow(ForbiddenException);
  });

  it('honours a mount-aware prefix', () => {
    const reflector = { getAllAndOverride: jest.fn().mockReturnValue(false) };
    const guard = new RolesGuard(reflector as unknown as Reflector, {
      mountPath: '/storage',
    } as never);
    expect(() =>
      guard.canActivate(context(req('DELETE', '/storage/api/admin/users/bob', 'readonly'))),
    ).toThrow(ForbiddenException);
    // Its allowlist is relative to the mount too.
    expect(
      guard.canActivate(context(req('POST', '/storage/api/admin/auth/logout', 'readonly'))),
    ).toBe(true);
  });
});
