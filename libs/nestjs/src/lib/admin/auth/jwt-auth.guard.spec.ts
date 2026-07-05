import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import type { JwtService } from '@nestjs/jwt';

import type { AdminUserRepository } from '../../persistence/index';
import { JwtAuthGuard } from './jwt-auth.guard';

/**
 * TEST-0408 — JwtAuthGuard (§5.3). Stubs Reflector + JwtService and feeds mock
 * ExecutionContexts to exercise every branch: non-admin path, @Public, missing /
 * malformed bearer, verification failure, and the success path.
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

function build(
  opts: {
    isPublic?: boolean;
    verify?: jest.Mock;
    mustChangePassword?: boolean;
    role?: 'admin' | 'readonly';
    /** When true, findByUsername resolves null (deleted row → least privilege). */
    missingRow?: boolean;
  } = {},
) {
  const reflector = { getAllAndOverride: jest.fn().mockReturnValue(opts.isPublic ?? false) };
  const jwt = { verifyAsync: opts.verify ?? jest.fn() };
  // The persisted AdminUser row the guard reads for forced-rotation + fresh role.
  const users = {
    findByUsername: jest
      .fn()
      .mockResolvedValue(
        opts.missingRow
          ? null
          : {
              username: 'admin',
              mustChangePassword: opts.mustChangePassword ?? false,
              role: opts.role ?? 'admin',
            },
      ),
  };
  const guard = new JwtAuthGuard(
    reflector as unknown as Reflector,
    jwt as unknown as JwtService,
    users as unknown as AdminUserRepository,
  );
  return { guard, reflector, jwt, users };
}

describe('JwtAuthGuard (TEST-0408)', () => {
  it('case 1: non-admin path (S3) → true without consulting reflector or jwt', async () => {
    const { guard, reflector, jwt } = build();
    await expect(guard.canActivate(context({ path: '/api/s3/bucket/key', headers: {} }))).resolves.toBe(true);
    expect(reflector.getAllAndOverride).not.toHaveBeenCalled();
    expect(jwt.verifyAsync).not.toHaveBeenCalled();
  });

  it('case 2: SPA path /admin/login → true without consulting jwt', async () => {
    const { guard, jwt } = build();
    await expect(guard.canActivate(context({ path: '/admin/login', headers: {} }))).resolves.toBe(true);
    expect(jwt.verifyAsync).not.toHaveBeenCalled();
  });

  it('case 3: admin path but @Public → true', async () => {
    const { guard, jwt } = build({ isPublic: true });
    await expect(
      guard.canActivate(context({ path: '/api/admin/auth/login', headers: {} })),
    ).resolves.toBe(true);
    expect(jwt.verifyAsync).not.toHaveBeenCalled();
  });

  it('case 4: admin path, missing Authorization → UnauthorizedException(missing bearer)', async () => {
    const { guard } = build();
    await expect(
      guard.canActivate(context({ path: '/api/admin/buckets', headers: {} })),
    ).rejects.toThrow(new UnauthorizedException('missing bearer'));
  });

  it('case 5: non-Bearer scheme → UnauthorizedException(missing bearer)', async () => {
    const { guard } = build();
    await expect(
      guard.canActivate(context({ path: '/api/admin/buckets', headers: { authorization: 'Token abc' } })),
    ).rejects.toThrow('missing bearer');
  });

  it('case 6: Bearer token that fails verification → UnauthorizedException(invalid token)', async () => {
    const verify = jest.fn().mockRejectedValue(new Error('bad signature'));
    const { guard } = build({ verify });
    await expect(
      guard.canActivate(context({ path: '/api/admin/buckets', headers: { authorization: 'Bearer xxx' } })),
    ).rejects.toThrow('invalid token');
  });

  it('case 7: valid Bearer token → true and req.user is the decoded payload (with fresh role)', async () => {
    const payload = { sub: 'admin', username: 'admin', mustChangePassword: false, role: 'admin', iat: 1, exp: 2 };
    const verify = jest.fn().mockResolvedValue(payload);
    const { guard } = build({ verify, role: 'admin' });
    const req: Record<string, unknown> = { path: '/api/admin/buckets', headers: { authorization: 'Bearer good' } };

    await expect(guard.canActivate(context(req))).resolves.toBe(true);
    expect(req.user).toEqual({ ...payload, role: 'admin' });
  });

  // EPIC-11 (STORY-1002): authorization runs off the LIVE DB role, not the token
  // claim, so a demotion takes effect on the very next request.
  it('case 7b: attaches the fresh DB role, overriding a stale token claim', async () => {
    const payload = { sub: 'admin', username: 'admin', mustChangePassword: false, role: 'admin', iat: 1, exp: 2 };
    const verify = jest.fn().mockResolvedValue(payload);
    // Token still says admin, but the persisted row was demoted to readonly.
    const { guard } = build({ verify, role: 'readonly' });
    const req: Record<string, unknown> = { path: '/api/admin/buckets', headers: { authorization: 'Bearer good' } };

    await expect(guard.canActivate(context(req))).resolves.toBe(true);
    expect((req.user as { role: string }).role).toBe('readonly');
  });

  it('case 7c: a vanished row defaults the attached role to readonly (least privilege)', async () => {
    const payload = { sub: 'admin', username: 'admin', mustChangePassword: false, role: 'admin', iat: 1, exp: 2 };
    const verify = jest.fn().mockResolvedValue(payload);
    const { guard } = build({ verify, missingRow: true });
    const req: Record<string, unknown> = { path: '/api/admin/buckets', headers: { authorization: 'Bearer good' } };

    await expect(guard.canActivate(context(req))).resolves.toBe(true);
    expect((req.user as { role: string }).role).toBe('readonly');
  });

  it('case 8: verification uses the openbucket issuer + audience', async () => {
    const verify = jest.fn().mockResolvedValue({ sub: 'admin', username: 'admin', mustChangePassword: false, iat: 1, exp: 2 });
    const { guard } = build({ verify });
    await guard.canActivate(context({ path: '/api/admin/buckets', headers: { authorization: 'Bearer good' } }));

    expect(verify).toHaveBeenCalledWith('good', { issuer: 'openbucket', audience: 'openbucket-admin' });
  });

  // TASK-2102 (CWE-620): forced-password-rotation enforcement reads the DB, not
  // the JWT claim, and confines a must-change principal to the recovery routes.
  const validPayload = { sub: 'admin', username: 'admin', mustChangePassword: false, iat: 1, exp: 2 };

  it('case 9: mustChangePassword principal is 403d on a normal admin route', async () => {
    const verify = jest.fn().mockResolvedValue(validPayload);
    const { guard, users } = build({ verify, mustChangePassword: true });
    await expect(
      guard.canActivate(context({ path: '/api/admin/buckets', headers: { authorization: 'Bearer good' } })),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(users.findByUsername).toHaveBeenCalledWith('admin');
  });

  it('case 10: mustChangePassword principal is allowed on change-password / logout / me', async () => {
    for (const path of [
      '/api/admin/settings/change-password',
      '/api/admin/auth/logout',
      '/api/admin/auth/me',
    ]) {
      const verify = jest.fn().mockResolvedValue(validPayload);
      const { guard } = build({ verify, mustChangePassword: true });
      await expect(
        guard.canActivate(context({ path, headers: { authorization: 'Bearer good' } })),
      ).resolves.toBe(true);
    }
  });

  it('case 11: enforcement uses the DB flag, not the token claim (stale false claim still 403s)', async () => {
    // Token claims mustChangePassword=false, but the persisted row says true —
    // the guard must trust the DB (a pre-fix refresh could mint a false claim).
    const verify = jest.fn().mockResolvedValue({ ...validPayload, mustChangePassword: false });
    const { guard } = build({ verify, mustChangePassword: true });
    await expect(
      guard.canActivate(context({ path: '/api/admin/buckets', headers: { authorization: 'Bearer good' } })),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('case 12: cleared flag → principal reaches all admin routes normally', async () => {
    const verify = jest.fn().mockResolvedValue(validPayload);
    const { guard } = build({ verify, mustChangePassword: false });
    await expect(
      guard.canActivate(context({ path: '/api/admin/buckets', headers: { authorization: 'Bearer good' } })),
    ).resolves.toBe(true);
  });
});
