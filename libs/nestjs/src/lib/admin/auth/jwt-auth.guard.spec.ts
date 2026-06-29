import { UnauthorizedException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import type { JwtService } from '@nestjs/jwt';

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

function build(opts: { isPublic?: boolean; verify?: jest.Mock } = {}) {
  const reflector = { getAllAndOverride: jest.fn().mockReturnValue(opts.isPublic ?? false) };
  const jwt = { verifyAsync: opts.verify ?? jest.fn() };
  const guard = new JwtAuthGuard(reflector as unknown as Reflector, jwt as unknown as JwtService);
  return { guard, reflector, jwt };
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

  it('case 7: valid Bearer token → true and req.user is the decoded payload', async () => {
    const payload = { sub: 'admin', username: 'admin', mustChangePassword: false, iat: 1, exp: 2 };
    const verify = jest.fn().mockResolvedValue(payload);
    const { guard } = build({ verify });
    const req: Record<string, unknown> = { path: '/api/admin/buckets', headers: { authorization: 'Bearer good' } };

    await expect(guard.canActivate(context(req))).resolves.toBe(true);
    expect(req.user).toEqual(payload);
  });

  it('case 8: verification uses the openbucket issuer + audience', async () => {
    const verify = jest.fn().mockResolvedValue({ sub: 'admin', username: 'admin', mustChangePassword: false, iat: 1, exp: 2 });
    const { guard } = build({ verify });
    await guard.canActivate(context({ path: '/api/admin/buckets', headers: { authorization: 'Bearer good' } }));

    expect(verify).toHaveBeenCalledWith('good', { issuer: 'openbucket', audience: 'openbucket-admin' });
  });
});
