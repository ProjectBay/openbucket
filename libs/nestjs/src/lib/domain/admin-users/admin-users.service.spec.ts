import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';

jest.mock('argon2');
import * as argon2 from 'argon2';

import { AdminUsersService } from './admin-users.service';
import type { AdminUserRepository, AdminUser } from '../../persistence/index';
import type { AuditService } from '../../admin/audit/audit.service';
import type { RefreshTokenService } from '../../admin/auth/refresh-token.service';

/**
 * TASK-3022 / [TEST-1002] cases 8–14 — AdminUsersService: create/update/delete
 * plus the lockout guardrails (409 duplicate, 409 last-admin delete, 409
 * last-admin demote, 403 self-delete) and the CWE-613 session eviction on reset
 * and delete.
 */
const hash = argon2.hash as jest.Mock;

interface Mocks {
  users: {
    findByUsername: jest.Mock;
    insert: jest.Mock;
    update: jest.Mock;
    delete: jest.Mock;
    list: jest.Mock;
    countByRole: jest.Mock;
  };
  audit: { emit: jest.Mock };
  refresh: { revokeAllForSubject: jest.Mock };
  svc: AdminUsersService;
}

function row(over: Partial<AdminUser> = {}): AdminUser {
  return {
    username: 'bob',
    passwordHash: 'h',
    mustChangePassword: false,
    role: 'admin',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    ...over,
  } as AdminUser;
}

function build(): Mocks {
  const users = {
    findByUsername: jest.fn(),
    insert: jest.fn((d) => Promise.resolve(row(d))),
    update: jest.fn().mockResolvedValue(undefined),
    delete: jest.fn().mockResolvedValue(undefined),
    list: jest.fn(),
    countByRole: jest.fn(),
  };
  const audit = { emit: jest.fn() };
  const refresh = { revokeAllForSubject: jest.fn().mockResolvedValue(undefined) };
  const svc = new AdminUsersService(
    users as unknown as AdminUserRepository,
    audit as unknown as AuditService,
    refresh as unknown as RefreshTokenService,
  );
  return { users, audit, refresh, svc };
}

describe('AdminUsersService (TASK-3022)', () => {
  beforeEach(() => hash.mockReset().mockResolvedValue('$argon2id$new'));

  it('create: hashes, inserts with mustChangePassword=true, emits admin.user.created', async () => {
    const m = build();
    m.users.findByUsername.mockResolvedValue(null);

    const created = await m.svc.create(
      { username: 'carol', password: 'a-long-enough-pw', role: 'readonly' },
      'admin',
    );

    expect(hash).toHaveBeenCalledWith('a-long-enough-pw', { type: argon2.argon2id });
    expect(m.users.insert).toHaveBeenCalledWith({
      username: 'carol',
      passwordHash: '$argon2id$new',
      role: 'readonly',
      mustChangePassword: true,
    });
    expect(created.mustChangePassword).toBe(true);
    expect(m.audit.emit).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'admin.user.created', subject: 'admin', target: 'carol', role: 'readonly' }),
    );
  });

  it('create: duplicate username → 409 Conflict', async () => {
    const m = build();
    m.users.findByUsername.mockResolvedValue(row({ username: 'carol' }));
    await expect(
      m.svc.create({ username: 'carol', password: 'a-long-enough-pw', role: 'admin' }, 'admin'),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(m.users.insert).not.toHaveBeenCalled();
  });

  it('update: unknown user → 404', async () => {
    const m = build();
    m.users.findByUsername.mockResolvedValue(null);
    await expect(m.svc.update('ghost', { role: 'admin' }, 'admin')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('update: role change emits admin.user.role.changed with from/to', async () => {
    const m = build();
    m.users.findByUsername.mockResolvedValue(row({ username: 'bob', role: 'admin' }));
    m.users.countByRole.mockResolvedValue(3); // not the last admin

    await m.svc.update('bob', { role: 'readonly' }, 'admin');

    expect(m.users.update).toHaveBeenCalledWith('bob', { role: 'readonly' });
    expect(m.audit.emit).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'admin.user.role.changed', from: 'admin', to: 'readonly', target: 'bob' }),
    );
  });

  it('update: demoting the last full admin → 409, no write', async () => {
    const m = build();
    m.users.findByUsername.mockResolvedValue(row({ username: 'admin', role: 'admin' }));
    m.users.countByRole.mockResolvedValue(1); // the only full admin

    await expect(m.svc.update('admin', { role: 'readonly' }, 'admin')).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(m.users.update).not.toHaveBeenCalled();
  });

  it('update: password reset hashes, forces rotation, evicts sessions, emits password.reset', async () => {
    const m = build();
    m.users.findByUsername.mockResolvedValue(row({ username: 'bob', role: 'readonly' }));

    await m.svc.update('bob', { newPassword: 'brand-new-password' }, 'admin');

    expect(m.users.update).toHaveBeenCalledWith('bob', {
      passwordHash: '$argon2id$new',
      mustChangePassword: true,
    });
    expect(m.refresh.revokeAllForSubject).toHaveBeenCalledWith('bob');
    expect(m.audit.emit).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'admin.user.password.reset', target: 'bob' }),
    );
  });

  it('remove: self-delete → 403, nothing touched', async () => {
    const m = build();
    await expect(m.svc.remove('admin', 'admin')).rejects.toBeInstanceOf(ForbiddenException);
    expect(m.users.findByUsername).not.toHaveBeenCalled();
    expect(m.users.delete).not.toHaveBeenCalled();
  });

  it('remove: deleting the last full admin → 409', async () => {
    const m = build();
    m.users.findByUsername.mockResolvedValue(row({ username: 'other', role: 'admin' }));
    m.users.countByRole.mockResolvedValue(1);
    await expect(m.svc.remove('other', 'admin')).rejects.toBeInstanceOf(ConflictException);
    expect(m.users.delete).not.toHaveBeenCalled();
  });

  it('remove: a peer deletes, evicts their sessions, emits admin.user.deleted', async () => {
    const m = build();
    m.users.findByUsername.mockResolvedValue(row({ username: 'bob', role: 'readonly' }));
    m.users.countByRole.mockResolvedValue(0);

    await m.svc.remove('bob', 'admin');

    expect(m.users.delete).toHaveBeenCalledWith('bob');
    expect(m.refresh.revokeAllForSubject).toHaveBeenCalledWith('bob');
    expect(m.audit.emit).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'admin.user.deleted', subject: 'admin', target: 'bob' }),
    );
  });

  it('list delegates to the repository', async () => {
    const m = build();
    m.users.list.mockResolvedValue([row()]);
    expect(await m.svc.list()).toHaveLength(1);
    expect(m.users.list).toHaveBeenCalled();
  });
});
