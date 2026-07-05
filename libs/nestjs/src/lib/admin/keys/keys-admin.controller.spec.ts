import { NotFoundException } from '@nestjs/common';
import type { Request } from 'express';

import { KeysAdminController } from './keys-admin.controller';
import type { KeyService } from '../../domain/keys/key.service';
import type { AuditService } from '../audit/audit.service';
import type { CreateKeyDto } from './dto/create-key.dto';
import type { UpdateKeyDto } from './dto/update-key.dto';
import type { SimulateRequestDto } from './dto/simulate.dto';

/**
 * TEST-0414 — KeysAdminController (§5.7). Verifies list/create/update/delete
 * mapping, the secret-once response, and the conditional update audit event.
 */
function build() {
  const keys = {
    list: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    rotate: jest.fn(),
    revoke: jest.fn(),
    findById: jest.fn(),
  };
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
        scopePolicy: null,
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
        scope: null,
      },
    ]);
  });

  it('case 1b: list renders a compiled prefix scope as a compact view', async () => {
    const { keys, ctrl } = build();
    keys.list.mockResolvedValue([
      {
        id: 'k1b',
        accessKeyId: 'AKIA1B',
        label: 'tenant',
        role: 'root',
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        lastUsedAt: null,
        disabled: false,
        scopePolicy: JSON.stringify({
          Version: '2012-10-17',
          Statement: [
            {
              Sid: 'ScopeObjects',
              Effect: 'Allow',
              Principal: '*',
              Action: ['s3:GetObject'],
              Resource: 'arn:aws:s3:::t-a/tenant-a/*',
            },
          ],
        }),
      },
    ]);

    const res = await ctrl.list();
    expect(res[0].scope).toEqual({ kind: 'prefix', bucket: 't-a', prefix: 'tenant-a/' });
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
      scopePolicy: null,
    });

    const res = await ctrl.create({ label: 'ci' } as CreateKeyDto, req);

    expect(keys.create).toHaveBeenCalledWith({ label: 'ci', role: 'root', scope: undefined });
    expect(audit.emit).toHaveBeenCalledWith({
      event: 'key.created',
      subject: 'admin',
      keyId: 'k2',
      scope: false,
      requestId: 'req-1',
    });
    expect(res.secretAccessKey).toBe('super-secret');
    expect(res).toMatchObject({ id: 'k2', accessKeyId: 'AKIA2', role: 'root', scope: null });
  });

  it('case 2b: create passes a scope through and echoes its summary, audit scope:true', async () => {
    const { keys, audit, ctrl } = build();
    const scope = { kind: 'prefix', bucket: 't-a', prefix: 'tenant-a/' } as const;
    keys.create.mockResolvedValue({
      id: 'k2b',
      accessKeyId: 'AKIA2B',
      secretAccessKey: 'super-secret',
      label: 'tenant',
      role: 'scoped',
      createdAt: new Date('2026-01-02T00:00:00.000Z'),
      scopePolicy: JSON.stringify({
        Version: '2012-10-17',
        Statement: [
          {
            Sid: 'ScopeObjects',
            Effect: 'Allow',
            Principal: '*',
            Action: ['s3:GetObject'],
            Resource: 'arn:aws:s3:::t-a/tenant-a/*',
          },
        ],
      }),
    });

    const res = await ctrl.create({ label: 'tenant', scope } as unknown as CreateKeyDto, req);

    // A scope mints a `scoped` sub-key; an unscoped create stays `root`.
    expect(keys.create).toHaveBeenCalledWith({ label: 'tenant', role: 'scoped', scope });
    expect(audit.emit).toHaveBeenCalledWith(expect.objectContaining({ event: 'key.created', scope: true }));
    expect(res.scope).toEqual({ kind: 'prefix', bucket: 't-a', prefix: 'tenant-a/' });
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

  it('case 6: rotate surfaces a fresh secret once and emits key.rotated', async () => {
    const { keys, audit, ctrl } = build();
    keys.rotate.mockResolvedValue({
      id: 'k6',
      accessKeyId: 'AKIA6',
      secretAccessKey: 'rolled-secret',
      label: 'ci',
      role: 'root',
      createdAt: new Date('2026-01-06T00:00:00.000Z'),
      scopePolicy: null,
    });

    const res = await ctrl.rotate('k6', req);

    expect(keys.rotate).toHaveBeenCalledWith('k6');
    expect(res.secretAccessKey).toBe('rolled-secret');
    expect(res).toMatchObject({ id: 'k6', accessKeyId: 'AKIA6', scope: null });
    expect(audit.emit).toHaveBeenCalledWith({
      event: 'key.rotated',
      subject: 'admin',
      keyId: 'k6',
      requestId: 'req-1',
    });
  });

  it('case 6b: rotate 404s on an unknown id', async () => {
    const { keys, ctrl } = build();
    keys.rotate.mockResolvedValue(null);
    await expect(ctrl.rotate('missing', req)).rejects.toThrow(NotFoundException);
  });

  it('case 7: revoke disables the key and emits key.revoked', async () => {
    const { keys, audit, ctrl } = build();
    keys.revoke.mockResolvedValue({
      id: 'k7',
      accessKeyId: 'AKIA7',
      label: 'ci',
      role: 'root',
      createdAt: new Date('2026-01-07T00:00:00.000Z'),
      lastUsedAt: null,
      disabled: true,
      scopePolicy: null,
    });

    const res = await ctrl.revoke('k7', req);

    expect(keys.revoke).toHaveBeenCalledWith('k7');
    expect(res).toMatchObject({ id: 'k7', disabled: true, scope: null });
    expect(audit.emit).toHaveBeenCalledWith({
      event: 'key.revoked',
      subject: 'admin',
      keyId: 'k7',
      requestId: 'req-1',
    });
  });

  it('case 7b: revoke 404s on an unknown id', async () => {
    const { keys, ctrl } = build();
    keys.revoke.mockResolvedValue(null);
    await expect(ctrl.revoke('missing', req)).rejects.toThrow(NotFoundException);
  });

  const tenantScope = JSON.stringify({
    Version: '2012-10-17',
    Statement: [
      {
        Sid: 'ScopeObjects',
        Effect: 'Allow',
        Principal: '*',
        Action: ['s3:GetObject', 's3:PutObject', 's3:DeleteObject'],
        Resource: 'arn:aws:s3:::tenant-a/uploads/*',
      },
      {
        Sid: 'ScopeList',
        Effect: 'Allow',
        Principal: '*',
        Action: 's3:ListBucket',
        Resource: 'arn:aws:s3:::tenant-a',
        Condition: { StringLike: { 's3:prefix': ['uploads/*', 'uploads/'] } },
      },
    ],
  });

  it('case 8: effective-permissions — scoped key allows inside scope, denies outside', async () => {
    const { keys, ctrl } = build();
    keys.findById.mockResolvedValue({
      id: 'k8',
      accessKeyId: 'AKIA8',
      role: 'scoped',
      scopePolicy: tenantScope,
    });

    const res = await ctrl.effectivePermissions('k8');

    expect(res.scoped).toBe(true);
    expect(res.scope).not.toBeNull();
    const objArn = 'arn:aws:s3:::tenant-a/uploads/*';
    const get = res.matrix.find((c) => c.action === 's3:GetObject' && c.resource === objArn);
    const abort = res.matrix.find(
      (c) => c.action === 's3:AbortMultipartUpload' && c.resource === objArn,
    );
    expect(get?.decision).toBe('allow');
    expect(abort?.decision).toBe('deny');
    const list = res.matrix.find(
      (c) => c.action === 's3:ListBucket' && c.resource === 'arn:aws:s3:::tenant-a',
    );
    expect(list?.decision).toBe('allow');
  });

  it('case 8b: effective-permissions — root/unscoped key is scoped:false, all-allow', async () => {
    const { keys, ctrl } = build();
    keys.findById.mockResolvedValue({
      id: 'k8b',
      accessKeyId: 'AKIA8B',
      role: 'root',
      scopePolicy: null,
    });

    const res = await ctrl.effectivePermissions('k8b');

    expect(res.scoped).toBe(false);
    expect(res.scope).toBeNull();
    expect(res.matrix.every((c) => c.decision === 'allow')).toBe(true);
  });

  it('case 8c: effective-permissions 404s on an unknown id', async () => {
    const { keys, ctrl } = build();
    keys.findById.mockResolvedValue(null);
    await expect(ctrl.effectivePermissions('missing')).rejects.toThrow(NotFoundException);
  });

  it('case 9: simulate parity — allow inside scope, deny outside; op-name normalized', async () => {
    const { keys, ctrl } = build();
    keys.findById.mockResolvedValue({
      id: 'k9',
      accessKeyId: 'AKIA9',
      role: 'scoped',
      scopePolicy: tenantScope,
    });

    const inside = await ctrl.simulate('k9', {
      action: 'GetObject',
      resource: 'arn:aws:s3:::tenant-a/uploads/report.csv',
    } as SimulateRequestDto);
    const outside = await ctrl.simulate('k9', {
      action: 's3:GetObject',
      resource: 'arn:aws:s3:::other-bucket/secret',
    } as SimulateRequestDto);

    expect(inside.decision).toBe('allow');
    expect(outside.decision).toBe('deny');
  });

  it('case 9b: simulate 404s on an unknown id', async () => {
    const { keys, ctrl } = build();
    keys.findById.mockResolvedValue(null);
    await expect(
      ctrl.simulate('missing', {
        action: 'GetObject',
        resource: 'arn:aws:s3:::x/y',
      } as SimulateRequestDto),
    ).rejects.toThrow(NotFoundException);
  });
});
