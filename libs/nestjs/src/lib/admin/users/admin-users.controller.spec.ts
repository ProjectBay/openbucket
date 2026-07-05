import type { Request } from 'express';

import { AdminUsersController } from './admin-users.controller';
import type { AdminUsersService } from '../../domain/admin-users/admin-users.service';
import type { AdminUser } from '../../persistence/index';

/**
 * TASK-3022 — AdminUsersController: verifies the request→service mapping, the
 * actor extraction from the guard-attached principal, and the secret-free
 * summary projection (never `passwordHash`).
 */
function build() {
  const adminUsers = {
    list: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    remove: jest.fn(),
  };
  const ctrl = new AdminUsersController(adminUsers as unknown as AdminUsersService);
  return { adminUsers, ctrl };
}

const req = { user: { username: 'admin' } } as unknown as Request;

function row(over: Partial<AdminUser> = {}): AdminUser {
  return {
    username: 'bob',
    passwordHash: 'SECRET-HASH',
    mustChangePassword: true,
    role: 'readonly',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    ...over,
  } as AdminUser;
}

describe('AdminUsersController (TASK-3022)', () => {
  it('list projects secret-free summaries (no passwordHash)', async () => {
    const { adminUsers, ctrl } = build();
    adminUsers.list.mockResolvedValue([row()]);

    const res = await ctrl.list();

    expect(res).toEqual([
      {
        username: 'bob',
        role: 'readonly',
        mustChangePassword: true,
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    ]);
    expect(JSON.stringify(res)).not.toContain('SECRET-HASH');
  });

  it('create passes the DTO + actor and returns a summary', async () => {
    const { adminUsers, ctrl } = build();
    adminUsers.create.mockResolvedValue(row({ username: 'carol', role: 'admin' }));

    const res = await ctrl.create(
      { username: 'carol', password: 'a-long-enough-pw', role: 'admin' },
      req,
    );

    expect(adminUsers.create).toHaveBeenCalledWith(
      { username: 'carol', password: 'a-long-enough-pw', role: 'admin' },
      'admin',
    );
    expect(res.username).toBe('carol');
    expect((res as unknown as Record<string, unknown>).passwordHash).toBeUndefined();
  });

  it('update forwards role + newPassword and the actor', async () => {
    const { adminUsers, ctrl } = build();
    await ctrl.update('bob', { role: 'admin', newPassword: 'brand-new-password' }, req);
    expect(adminUsers.update).toHaveBeenCalledWith(
      'bob',
      { role: 'admin', newPassword: 'brand-new-password' },
      'admin',
    );
  });

  it('remove forwards the target username and actor', async () => {
    const { adminUsers, ctrl } = build();
    await ctrl.remove('bob', req);
    expect(adminUsers.remove).toHaveBeenCalledWith('bob', 'admin');
  });
});
