import { NotFoundException } from '@nestjs/common';
import type { Request } from 'express';

import { BucketsAdminController } from './buckets-admin.controller';
import type { BucketService } from '../../domain/buckets/bucket.service';
import type { ObjectService } from '../../domain/objects/object.service';
import type { AuditService } from '../audit/audit.service';
import { BucketNotEmptyError } from '../../s3/errors/s3-error';
import { CreateBucketDto } from './dto/create-bucket.dto';
import type { VersioningConfigDto } from './dto/versioning.dto';
import type { TaggingDto } from './dto/tagging.dto';
import type { EncryptionConfigDto } from './dto/encryption.dto';
import type { LifecycleConfigDto } from './dto/lifecycle.dto';
import type { CorsConfigDto } from './dto/cors.dto';
import type { ObjectLockConfigDto } from './dto/object-lock.dto';
import type { BucketPolicyDto } from './dto/policy.dto';

/**
 * TEST-0410 — BucketsAdminController (§5.5). Confirms the controller is a thin
 * adapter over the domain services and emits audit events on create/delete.
 */
function build() {
  const buckets = {
    listWithStats: jest.fn(),
    create: jest.fn(),
    findByName: jest.fn(),
    deleteByName: jest.fn(),
    setVersioning: jest.fn(),
    getTaggingMap: jest.fn(),
    setTagging: jest.fn(),
    clearTagging: jest.fn(),
    getEncryptionConfig: jest.fn(),
    setEncryption: jest.fn(),
    clearEncryption: jest.fn(),
    getLifecycleRules: jest.fn(),
    setLifecycle: jest.fn(),
    clearLifecycle: jest.fn(),
    getCorsRules: jest.fn(),
    setCors: jest.fn(),
    clearCors: jest.fn(),
    getObjectLock: jest.fn(),
    setObjectLock: jest.fn(),
    getPolicyDoc: jest.fn(),
    setPolicy: jest.fn(),
    clearPolicy: jest.fn(),
  };
  const objects = { statsFor: jest.fn() };
  const audit = { emit: jest.fn() };
  const ctrl = new BucketsAdminController(
    buckets as unknown as BucketService,
    objects as unknown as ObjectService,
    audit as unknown as AuditService,
  );
  return { buckets, objects, audit, ctrl };
}

const req = { openbucket: { requestId: 'req-1' }, user: { username: 'admin' } } as unknown as Request;

describe('BucketsAdminController (TEST-0410)', () => {
  it('case 1: list shapes the response with ISO createdAt + total', async () => {
    const { buckets, ctrl } = build();
    buckets.listWithStats.mockResolvedValue([
      {
        name: 'b1',
        createdAt: new Date('2026-01-02T03:04:05.000Z'),
        versioning: 'disabled',
        objectLock: false,
        stats: { objectCount: 2, sizeBytes: 10 },
      },
    ]);

    const res = await ctrl.list();

    expect(res.total).toBe(1);
    expect(res.buckets[0]).toEqual({
      name: 'b1',
      createdAt: '2026-01-02T03:04:05.000Z',
      versioning: 'disabled',
      objectLock: false,
      objectCount: 2,
      sizeBytes: 10,
    });
  });

  it('case 2: create calls the service, emits bucket.created, returns a zeroed summary', async () => {
    const { buckets, audit, ctrl } = build();
    buckets.create.mockResolvedValue({
      name: 'foo',
      createdAt: new Date('2026-01-02T00:00:00.000Z'),
      versioning: 'enabled',
      objectLock: { enabled: true },
    });

    const dto = { name: 'foo', versioning: 'enabled', objectLock: true, region: 'us-east-1' } as CreateBucketDto;
    const res = await ctrl.create(dto, req);

    expect(buckets.create).toHaveBeenCalledWith({
      name: 'foo',
      versioning: 'enabled',
      objectLock: true,
      region: 'us-east-1',
    });
    expect(audit.emit).toHaveBeenCalledWith({
      event: 'bucket.created',
      subject: 'admin',
      bucket: 'foo',
      requestId: 'req-1',
    });
    expect(res).toEqual({
      name: 'foo',
      createdAt: '2026-01-02T00:00:00.000Z',
      versioning: 'enabled',
      objectLock: true,
      objectCount: 0,
      sizeBytes: 0,
    });
  });

  it('case 3a: get throws NotFoundException when the bucket is missing', async () => {
    const { buckets, ctrl } = build();
    buckets.findByName.mockResolvedValue(null);
    await expect(ctrl.get('missing')).rejects.toThrow(NotFoundException);
  });

  it('case 3b: get merges stats from ObjectService.statsFor', async () => {
    const { buckets, objects, ctrl } = build();
    buckets.findByName.mockResolvedValue({
      name: 'foo',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      versioning: 'disabled',
      objectLock: undefined,
    });
    objects.statsFor.mockResolvedValue({ objectCount: 5, sizeBytes: 99 });

    const res = await ctrl.get('foo');

    expect(objects.statsFor).toHaveBeenCalledWith('foo');
    expect(res).toMatchObject({ name: 'foo', objectCount: 5, sizeBytes: 99, objectLock: false });
  });

  it('case 4: delete calls deleteByName and emits bucket.deleted', async () => {
    const { buckets, audit, ctrl } = build();
    buckets.deleteByName.mockResolvedValue(undefined);

    await ctrl.delete('foo', req);

    expect(buckets.deleteByName).toHaveBeenCalledWith('foo');
    expect(audit.emit).toHaveBeenCalledWith({
      event: 'bucket.deleted',
      subject: 'admin',
      bucket: 'foo',
      requestId: 'req-1',
    });
  });

  it('case 5: delete propagates BucketNotEmpty (no audit, not swallowed)', async () => {
    const { buckets, audit, ctrl } = build();
    buckets.deleteByName.mockRejectedValue(new BucketNotEmptyError('not empty'));

    await expect(ctrl.delete('foo', req)).rejects.toBeInstanceOf(BucketNotEmptyError);
    expect(audit.emit).not.toHaveBeenCalled();
  });
});

describe('BucketsAdminController config sub-resources (STORY-0612)', () => {
  it('putVersioning maps status + emits versioning.changed {from,to}', async () => {
    const { buckets, audit, ctrl } = build();
    buckets.setVersioning.mockResolvedValue({ from: 'disabled', to: 'enabled' });

    await ctrl.putVersioning('b', { status: 'Enabled' } as VersioningConfigDto, req);

    expect(buckets.setVersioning).toHaveBeenCalledWith('b', 'Enabled');
    expect(audit.emit).toHaveBeenCalledWith({
      event: 'bucket.versioning.changed',
      subject: 'admin',
      bucket: 'b',
      from: 'disabled',
      to: 'enabled',
      requestId: 'req-1',
    });
  });

  it('tagging: get returns {tags}; put/delete map + audit', async () => {
    const { buckets, audit, ctrl } = build();
    buckets.getTaggingMap.mockResolvedValue({ env: 'prod' });
    expect(await ctrl.getTagging('b')).toEqual({ tags: { env: 'prod' } });

    await ctrl.putTagging('b', { tags: { env: 'prod' } } as TaggingDto, req);
    expect(buckets.setTagging).toHaveBeenCalledWith('b', { env: 'prod' });
    expect(audit.emit).toHaveBeenCalledWith({
      event: 'bucket.tagging.changed',
      subject: 'admin',
      bucket: 'b',
      requestId: 'req-1',
    });

    await ctrl.deleteTagging('b', req);
    expect(buckets.clearTagging).toHaveBeenCalledWith('b');
  });

  it('encryption: get returns config; put maps + audit', async () => {
    const { buckets, audit, ctrl } = build();
    buckets.getEncryptionConfig.mockResolvedValue({ algorithm: 'AES256' });
    expect(await ctrl.getEncryption('b')).toEqual({ algorithm: 'AES256' });

    await ctrl.putEncryption('b', { algorithm: 'AES256' } as EncryptionConfigDto, req);
    expect(buckets.setEncryption).toHaveBeenCalledWith('b', 'AES256');
    expect(audit.emit).toHaveBeenCalledWith({
      event: 'bucket.encryption.changed',
      subject: 'admin',
      bucket: 'b',
      requestId: 'req-1',
    });
  });

  it('lifecycle: get returns {rules}; put maps + audit', async () => {
    const { buckets, audit, ctrl } = build();
    const rules = [{ id: 'r1', status: 'Enabled', expirationDays: 30 }];
    buckets.getLifecycleRules.mockResolvedValue(rules);
    expect(await ctrl.getLifecycle('b')).toEqual({ rules });

    await ctrl.putLifecycle('b', { rules } as unknown as LifecycleConfigDto, req);
    expect(buckets.setLifecycle).toHaveBeenCalledWith('b', rules);
    expect(audit.emit).toHaveBeenCalledWith({
      event: 'bucket.lifecycle.changed',
      subject: 'admin',
      bucket: 'b',
      requestId: 'req-1',
    });
  });

  it('cors: get returns {rules}; put maps + audit', async () => {
    const { buckets, audit, ctrl } = build();
    const rules = [{ allowedOrigins: ['*'], allowedMethods: ['GET'] }];
    buckets.getCorsRules.mockResolvedValue(rules);
    expect(await ctrl.getCors('b')).toEqual({ rules });

    await ctrl.putCors('b', { rules } as unknown as CorsConfigDto, req);
    expect(buckets.setCors).toHaveBeenCalledWith('b', rules);
    expect(audit.emit).toHaveBeenCalledWith({
      event: 'bucket.cors.changed',
      subject: 'admin',
      bucket: 'b',
      requestId: 'req-1',
    });
  });

  it('object-lock: get returns config; put maps + audit', async () => {
    const { buckets, audit, ctrl } = build();
    const cfg = { enabled: true, mode: 'governance' as const, defaultRetentionDays: 7 };
    buckets.getObjectLock.mockResolvedValue(cfg);
    expect(await ctrl.getObjectLock('b')).toEqual(cfg);

    await ctrl.putObjectLock('b', cfg as ObjectLockConfigDto, req);
    expect(buckets.setObjectLock).toHaveBeenCalledWith('b', cfg);
    expect(audit.emit).toHaveBeenCalledWith({
      event: 'bucket.objectlock.changed',
      subject: 'admin',
      bucket: 'b',
      requestId: 'req-1',
    });
  });

  it('policy: get returns {policy}; put maps + audit', async () => {
    const { buckets, audit, ctrl } = build();
    const policy = { Version: '2012-10-17', Statement: [] };
    buckets.getPolicyDoc.mockResolvedValue(policy);
    expect(await ctrl.getPolicy('b')).toEqual({ policy });

    await ctrl.putPolicy('b', { policy } as unknown as BucketPolicyDto, req);
    expect(buckets.setPolicy).toHaveBeenCalledWith('b', policy);
    expect(audit.emit).toHaveBeenCalledWith({
      event: 'bucket.policy.changed',
      subject: 'admin',
      bucket: 'b',
      requestId: 'req-1',
    });
  });
});
