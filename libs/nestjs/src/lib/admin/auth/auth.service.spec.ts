import { UnauthorizedException } from '@nestjs/common';
import type { JwtService } from '@nestjs/jwt';

jest.mock('argon2');
import * as argon2 from 'argon2';

import { AuthService } from './auth.service';
import type { RefreshTokenService } from './refresh-token.service';
import type { AdminUserRepository } from '../../persistence/index';

/**
 * TEST-0401 — AuthService (§5.2.2). Collaborators are mocked; argon2 is mocked
 * so verify outcomes are controlled. The AdminUser primary key (username) is
 * the JWT `sub`.
 */
const verify = argon2.verify as jest.Mock;

interface Mocks {
  jwt: { signAsync: jest.Mock };
  users: { findByUsername: jest.Mock };
  refresh: { mint: jest.Mock; rotate: jest.Mock; revoke: jest.Mock };
  svc: AuthService;
}

function build(): Mocks {
  const jwt = { signAsync: jest.fn().mockResolvedValue('access.jwt') };
  const users = { findByUsername: jest.fn() };
  const refresh = { mint: jest.fn(), rotate: jest.fn(), revoke: jest.fn() };
  const svc = new AuthService(
    jwt as unknown as JwtService,
    users as unknown as AdminUserRepository,
    refresh as unknown as RefreshTokenService,
  );
  return { jwt, users, refresh, svc };
}

describe('AuthService (TEST-0401)', () => {
  beforeEach(() => verify.mockReset());

  it('login: valid credentials → signs JWT {sub,username,mustChangePassword} + mints refresh', async () => {
    const m = build();
    m.users.findByUsername.mockResolvedValue({
      username: 'admin',
      passwordHash: '$argon2id$stored',
      mustChangePassword: false,
    });
    verify.mockResolvedValue(true);
    const expiresAt = new Date('2030-01-01T00:00:00Z');
    m.refresh.mint.mockResolvedValue({ token: 'refresh-raw', expiresAt });

    const tokens = await m.svc.login('admin', 'correct');

    expect(verify).toHaveBeenCalledWith('$argon2id$stored', 'correct');
    expect(m.jwt.signAsync).toHaveBeenCalledWith({
      sub: 'admin',
      username: 'admin',
      mustChangePassword: false,
    });
    expect(m.refresh.mint).toHaveBeenCalledWith('admin', 'admin');
    expect(tokens).toEqual({
      accessToken: 'access.jwt',
      expiresIn: 15 * 60,
      refreshToken: 'refresh-raw',
      refreshExpiresAt: expiresAt,
    });
  });

  it('login: carries mustChangePassword=true into the access-token claims', async () => {
    const m = build();
    m.users.findByUsername.mockResolvedValue({
      username: 'admin',
      passwordHash: 'h',
      mustChangePassword: true,
    });
    verify.mockResolvedValue(true);
    m.refresh.mint.mockResolvedValue({ token: 'r', expiresAt: new Date() });

    await m.svc.login('admin', 'pw');

    expect(m.jwt.signAsync).toHaveBeenCalledWith(
      expect.objectContaining({ mustChangePassword: true }),
    );
  });

  it('login: wrong password → UnauthorizedException(invalid credentials)', async () => {
    const m = build();
    m.users.findByUsername.mockResolvedValue({ username: 'admin', passwordHash: 'h', mustChangePassword: false });
    verify.mockResolvedValue(false);

    await expect(m.svc.login('admin', 'bad')).rejects.toThrow(UnauthorizedException);
    await expect(m.svc.login('admin', 'bad')).rejects.toThrow('invalid credentials');
    expect(m.jwt.signAsync).not.toHaveBeenCalled();
  });

  it('login: unknown user → dummy verify runs (constant-time) then UnauthorizedException', async () => {
    const m = build();
    m.users.findByUsername.mockResolvedValue(null);
    verify.mockResolvedValue(false);

    await expect(m.svc.login('ghost', 'pw')).rejects.toThrow('invalid credentials');
    // The dummy verify equalises timing — a real argon2 hash is verified.
    expect(verify).toHaveBeenCalledWith(expect.stringContaining('$argon2id$'), 'pw');
    expect(m.refresh.mint).not.toHaveBeenCalled();
  });

  it('refresh: delegates to RefreshTokenService.rotate and reuses the rotated refresh token', async () => {
    const m = build();
    const expiresAt = new Date('2031-06-01T00:00:00Z');
    m.refresh.rotate.mockResolvedValue({
      subjectId: 'admin',
      username: 'admin',
      token: 'rotated-raw',
      expiresAt,
    });

    const tokens = await m.svc.refresh('old-raw');

    expect(m.refresh.rotate).toHaveBeenCalledWith('old-raw');
    expect(m.refresh.mint).not.toHaveBeenCalled(); // rotation pre-issues the refresh
    expect(m.jwt.signAsync).toHaveBeenCalledWith({
      sub: 'admin',
      username: 'admin',
      mustChangePassword: false,
    });
    expect(tokens.refreshToken).toBe('rotated-raw');
    expect(tokens.refreshExpiresAt).toBe(expiresAt);
  });

  it('logout: revokes when a raw token is present, no-ops when undefined', async () => {
    const m = build();
    await m.svc.logout('raw');
    expect(m.refresh.revoke).toHaveBeenCalledWith('raw');

    m.refresh.revoke.mockClear();
    await m.svc.logout(undefined);
    expect(m.refresh.revoke).not.toHaveBeenCalled();
  });
});
