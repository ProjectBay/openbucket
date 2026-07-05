import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { AdminUsersService } from '@openbucket/api-client';

import { AdminUsersSignalStore } from './admin-users.signal-store';

/**
 * TASK-3023 / [TEST-1002] case 15 — AdminUsersSignalStore CRUD over the
 * regenerated AdminUsersService.
 *
 * NOTE: parked until the frontend jest harness is wired (no test target yet);
 * the store is build-verified. Covers refresh/create/update/remove local state.
 */
describe('AdminUsersSignalStore (TASK-3023)', () => {
  let api: {
    listAdminUsers: jest.Mock;
    createAdminUser: jest.Mock;
    updateAdminUser: jest.Mock;
    deleteAdminUser: jest.Mock;
  };
  let store: AdminUsersSignalStore;

  const row = (username: string, role: 'admin' | 'readonly' = 'readonly') => ({
    username,
    role,
    mustChangePassword: true,
    createdAt: '2026-01-01T00:00:00.000Z',
  });

  beforeEach(() => {
    api = {
      listAdminUsers: jest.fn(),
      createAdminUser: jest.fn(),
      updateAdminUser: jest.fn(),
      deleteAdminUser: jest.fn(),
    };
    TestBed.configureTestingModule({
      providers: [{ provide: AdminUsersService, useValue: api }],
    });
    store = TestBed.inject(AdminUsersSignalStore);
  });

  it('refresh loads the list', async () => {
    api.listAdminUsers.mockReturnValue(of([row('bob'), row('amy', 'admin')]));
    await store.refresh();
    expect(store.count()).toBe(2);
    expect(store.error()).toBeNull();
  });

  it('create appends the new admin', async () => {
    api.listAdminUsers.mockReturnValue(of([]));
    await store.refresh();
    api.createAdminUser.mockReturnValue(of(row('carol', 'admin')));
    await store.create({ username: 'carol', password: 'a-long-enough-pw', role: 'admin' } as never);
    expect(store.items().map((u) => u.username)).toEqual(['carol']);
  });

  it('update patches the local role', async () => {
    api.listAdminUsers.mockReturnValue(of([row('bob', 'readonly')]));
    await store.refresh();
    api.updateAdminUser.mockReturnValue(of(undefined));
    await store.update('bob', { role: 'admin' } as never);
    expect(store.items()[0].role).toBe('admin');
  });

  it('remove drops the row', async () => {
    api.listAdminUsers.mockReturnValue(of([row('bob'), row('amy', 'admin')]));
    await store.refresh();
    api.deleteAdminUser.mockReturnValue(of(undefined));
    await store.remove('bob');
    expect(store.items().map((u) => u.username)).toEqual(['amy']);
  });
});
