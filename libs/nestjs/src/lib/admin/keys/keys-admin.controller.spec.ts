import { NotFoundException } from '@nestjs/common';
import type { Request } from 'express';

import { KeysAdminController } from './keys-admin.controller';
import type { KeyService } from '../../domain/keys/key.service';
import type { AuditService } from '../audit/audit.service';
import type { CreateKeyDto } from './dto/create-key.dto';
import type { UpdateKeyDto } from './dto/update-key.dto';

/**
 * TEST-0414 — KeysAdminController (§5.7). Verifies list/create/update/delete
 * mapping, the secret-once response, and the conditional update audit event.
 */
function build() {
  const keys = { list: jest.fn(), create: jest.fn(), update: jest.fn(), delete: jest.fn() };
  const audit = { emit: jest.fn() };
  const ctrl = new KeysAdminController(
    keys as unknown as KeyService,
    audit as unknown as AuditService,
  );
  return { keys, audit, ctrl };
}

const req = { openbucket: { requestId: 'req-1' }, user: { username: 'admin' } } as unknown as Request;

describe('KeysAdminController (TEST-0414)', () => {
  it('case 1: list maps summaries (lastUsedAt → null, role root)', async () => {
    const { keys, ctrl } = build();
    keys.list.mockResolvedValue([
      {
        id: 'k1',
        accessKeyId: 'AKIA1',
        label: 'ci',
        role: 'root',
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        lastUsedAt: undefined,
        disabled: false,
      },
    ]);

    const res = await ctrl.list();

    expect(res).toEqual([
      {
        id: 'k1',
        accessKeyId: 'AKIA1',
        label: 'ci',
        role: 'root',
        createdAt: '2026-01-01T00:00:00.000Z',
        lastUsedAt: null,
        disabled: false,
      },
    ]);
  });

  it('case 2: create surfaces the secret once and emits key.created', async () => {
    const { keys, audit, ctrl } = build();
    keys.create.mockResolvedValue({
      id: 'k2',
      accessKeyId: 'AKIA2',
      secretAccessKey: 'super-secret',
      label: 'ci',
      role: 'root',
      createdAt: new Date('2026-01-02T00:00:00.000Z'),
    });

    const res = await ctrl.create({ label: 'ci' } as CreateKeyDto, req);

    expect(keys.create).toHaveBeenCalledWith({ label: 'ci', role: 'root' });
    expect(audit.emit).toHaveBeenCalledWith({
      event: 'key.created',
      subject: 'admin',
      keyId: 'k2',
      requestId: 'req-1',
    });
    expect(res.secretAccessKey).toBe('super-secret');
    expect(res).toMatchObject({ id: 'k2', accessKeyId: 'AKIA2', role: 'root' });
  });

  it('case 3: update emits key.disabled vs key.updated by intent', async () => {
    const summary = {
      id: 'k3',
      accessKeyId: 'AKIA3',
      label: 'l',
      role: 'root',
      createdAt: new Date('2026-01-03T00:00:00.000Z'),
      lastUsedAt: null,
      disabled: false,
    };

    for (const [dto, event] of [
      [{ disabled: true }, 'key.disabled'],
      [{ label: 'new' }, 'key.updated'],
      [{ disabled: false }, 'key.updated'],
    ] as Array<[UpdateKeyDto, string]>) {
      const { keys, audit, ctrl } = build();
      keys.update.mockResolvedValue(summary);
      await ctrl.update('k3', dto, req);
      expect(audit.emit).toHaveBeenCalledWith(expect.objectContaining({ event, keyId: 'k3' }));
    }
  });

  it('case 4: update throws NotFoundException when the key is missing', async () => {
    const { keys, ctrl } = build();
    keys.update.mockResolvedValue(null);
    await expect(ctrl.update('missing', { label: 'x' } as UpdateKeyDto, req)).rejects.toThrow(
      NotFoundException,
    );
  });

  it('case 5: delete emits key.deleted', async () => {
    const { keys, audit, ctrl } = build();
    keys.delete.mockResolvedValue(undefined);

    await ctrl.delete('k5', req);

    expect(keys.delete).toHaveBeenCalledWith('k5');
    expect(audit.emit).toHaveBeenCalledWith({
      event: 'key.deleted',
      subject: 'admin',
      keyId: 'k5',
      requestId: 'req-1',
    });
  });
});
