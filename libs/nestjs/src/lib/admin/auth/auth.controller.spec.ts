import type { Response } from 'express';

import { AuthController } from './auth.controller';

/**
 * The refresh cookie's `path` must match the mount prefix under which the auth
 * routes are served (`<mountPath>/api/admin/auth`), or the browser won't send the
 * cookie back to the mounted `/refresh` endpoint. Standalone (no options) →
 * `/api/admin/auth`; library `mountPath: '/storage'` → `/storage/api/admin/auth`.
 */
describe('AuthController — refresh cookie path is mount-aware', () => {
  const tokens = {
    accessToken: 'access',
    refreshToken: 'refresh',
    refreshExpiresAt: new Date('2026-01-01T00:00:00Z'),
    expiresIn: 900,
  };

  const makeAuth = () => ({
    login: jest.fn().mockResolvedValue(tokens),
    refresh: jest.fn().mockResolvedValue(tokens),
    logout: jest.fn().mockResolvedValue(undefined),
  });
  const audit = { emit: jest.fn() };
  const makeRes = () => ({ cookie: jest.fn(), clearCookie: jest.fn() }) as unknown as Response;
  const req = { ip: '127.0.0.1', headers: { cookie: 'ob_refresh=tok' } };

  it('scopes the cookie to /api/admin/auth for the standalone (no options)', async () => {
    const auth = makeAuth();
    const ctrl = new AuthController(auth as never, audit as never, undefined);
    const res = makeRes();

    await ctrl.login({ username: 'admin', password: 'pw' } as never, req as never, res);

    expect(res.cookie).toHaveBeenCalledWith(
      'ob_refresh',
      'refresh',
      expect.objectContaining({ path: '/api/admin/auth', httpOnly: true, sameSite: 'strict' }),
    );
  });

  it('scopes the cookie to <mountPath>/api/admin/auth under a mount', async () => {
    const auth = makeAuth();
    const ctrl = new AuthController(auth as never, audit as never, {
      mountPath: '/storage',
    } as never);
    const res = makeRes();

    await ctrl.login({ username: 'admin', password: 'pw' } as never, req as never, res);
    expect(res.cookie).toHaveBeenCalledWith(
      'ob_refresh',
      'refresh',
      expect.objectContaining({ path: '/storage/api/admin/auth' }),
    );

    // refresh rotates + re-sets the cookie at the same path.
    await ctrl.refresh(req as never, res);
    expect((res.cookie as jest.Mock).mock.calls.at(-1)?.[2]).toMatchObject({
      path: '/storage/api/admin/auth',
    });
  });

  it('clears the cookie at the mounted path on logout', async () => {
    const auth = makeAuth();
    const ctrl = new AuthController(auth as never, audit as never, {
      mountPath: '/storage',
    } as never);
    const res = makeRes();

    await ctrl.logout({ ...req, user: { username: 'admin' } } as never, res);
    expect(res.clearCookie).toHaveBeenCalledWith('ob_refresh', { path: '/storage/api/admin/auth' });
  });
});
