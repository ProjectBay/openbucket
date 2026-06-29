import { Logger } from '@nestjs/common';
import type { EntityManager } from '@mikro-orm/better-sqlite';
import type { ConfigService } from '@nestjs/config';
import * as argon2 from 'argon2';

import { AdminBootstrapService } from './admin-bootstrap.service';

/**
 * TEST-0416 — AdminBootstrapService (§5.8). The service forks the injected EM
 * and resolves the AdminUserRepository from the fork (boot runs outside a
 * request context), so the mock EM hands back a mocked repository. ConfigService
 * is mocked per case; Logger is spied. argon2 is real so the temp-password
 * hashing round-trips.
 */
function build(envHash?: string) {
  const users = {
    findByUsername: jest.fn(),
    insert: jest.fn(),
    upsert: jest.fn(),
    update: jest.fn(),
  };
  const fork = { getRepository: jest.fn().mockReturnValue(users) };
  const em = { fork: jest.fn().mockReturnValue(fork) };
  const config = { get: jest.fn().mockReturnValue(envHash) };
  const svc = new AdminBootstrapService(
    em as unknown as EntityManager,
    config as unknown as ConfigService,
  );
  return { users, em, config, svc };
}

describe('AdminBootstrapService (TEST-0416)', () => {
  let warnSpy: jest.SpyInstance;
  let logSpy: jest.SpyInstance;

  beforeEach(() => {
    warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    warnSpy.mockRestore();
    logSpy.mockRestore();
  });

  it('case 1: ADMIN_PASSWORD_HASH set → upsert(false), no temp password logged', async () => {
    const { users, config, svc } = build('$argon2id$v=19$m=65536,t=3,p=4$abc$def');

    await svc.onApplicationBootstrap();

    expect(config.get).toHaveBeenCalledWith('ADMIN_PASSWORD_HASH');
    expect(users.upsert).toHaveBeenCalledTimes(1);
    expect(users.upsert).toHaveBeenCalledWith({
      username: 'admin',
      passwordHash: '$argon2id$v=19$m=65536,t=3,p=4$abc$def',
      mustChangePassword: false,
    });
    expect(users.insert).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalledWith(expect.stringContaining('TEMP-ADMIN-PASSWORD'));
  });

  it('case 2: no env, no existing user → insert(true) + TEMP-ADMIN-PASSWORD warn', async () => {
    const { users, svc } = build(undefined);
    users.findByUsername.mockResolvedValue(null);

    await svc.onApplicationBootstrap();

    expect(users.insert).toHaveBeenCalledTimes(1);
    expect(users.insert.mock.calls[0][0]).toMatchObject({
      username: 'admin',
      mustChangePassword: true,
    });
    expect(users.upsert).not.toHaveBeenCalled();
    const warnMsg = warnSpy.mock.calls[0][0] as string;
    expect(warnMsg).toContain('TEMP-ADMIN-PASSWORD username=admin password=');
    expect(warnMsg).toContain('change-on-first-login=true');
  });

  it('case 3: no env, existing user → no writes, no warn', async () => {
    const { users, svc } = build(undefined);
    users.findByUsername.mockResolvedValue({ username: 'admin', passwordHash: 'h', mustChangePassword: false });

    await svc.onApplicationBootstrap();

    expect(users.insert).not.toHaveBeenCalled();
    expect(users.upsert).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('case 4: temp password is 24 chars (base64url over 18 bytes)', async () => {
    const { users, svc } = build(undefined);
    users.findByUsername.mockResolvedValue(null);

    await svc.onApplicationBootstrap();

    const warnMsg = warnSpy.mock.calls[0][0] as string;
    const temp = warnMsg.match(/password=(\S+) change-on-first-login/)?.[1];
    expect(temp).toMatch(/^[A-Za-z0-9_-]{24}$/);
  });

  it('case 5: the temp password is argon2id-hashed before insert (not plaintext)', async () => {
    const { users, svc } = build(undefined);
    users.findByUsername.mockResolvedValue(null);

    await svc.onApplicationBootstrap();

    const warnMsg = warnSpy.mock.calls[0][0] as string;
    const temp = warnMsg.match(/password=(\S+) change-on-first-login/)![1];
    const storedHash = users.insert.mock.calls[0][0].passwordHash as string;

    expect(storedHash.startsWith('$argon2id$')).toBe(true);
    expect(storedHash).not.toBe(temp);
    expect(await argon2.verify(storedHash, temp)).toBe(true);
  });
});
