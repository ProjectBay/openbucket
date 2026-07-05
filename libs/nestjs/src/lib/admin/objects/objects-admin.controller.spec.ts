import { NotFoundException } from '@nestjs/common';
import type { Request, Response } from 'express';

import { ObjectsAdminController } from './objects-admin.controller';
import type { ObjectService } from '../../domain/objects/object.service';
import type { AuditService } from '../audit/audit.service';
import type { AppConfigService } from '../../common/config/app-config.service';
import type { ListObjectsQueryDto } from './dto/list-objects-query.dto';
import type { ObjectVersionsQueryDto } from './dto/object-versions-query.dto';
import type { ObjectTaggingDto } from './dto/object-tagging.dto';
import type { RetentionDto } from './dto/retention.dto';
import type { LegalHoldDto } from './dto/legal-hold.dto';
import type { PresignRequestDto } from './dto/presign.dto';
import type { BulkDeleteDto } from './dto/bulk-delete.dto';
import { verifyPresigned, MAX_EXPIRES } from '../../s3/sigv4/presigned';
import type { KeyService } from '../../s3/sigv4/key.service';
import type { Sigv4Verifier } from '../../s3/sigv4/sigv4.verifier';

/**
 * TEST-0412 — ObjectsAdminController (§5.6/§5.14). Verifies the pagination
 * shape, the single-decode of slash-bearing keys (§5.13), the GET branch
 * (metadata JSON vs `?content`/`?download` streaming), streamed upload, and
 * audit emission.
 */
function build() {
  const objects = {
    list: jest.fn(),
    head: jest.fn(),
    getObject: jest.fn(),
    putFromStream: jest.fn(),
    delete: jest.fn(),
    deleteOne: jest.fn(),
    listVersionsJson: jest.fn(),
    getTaggingMap: jest.fn(),
    setTaggingMap: jest.fn(),
    clearTaggingMap: jest.fn(),
    getRetentionJson: jest.fn(),
    setRetention: jest.fn(),
    getLegalHoldStatus: jest.fn(),
    setLegalHold: jest.fn(),
  };
  const audit = { emit: jest.fn() };
  const config = {
    rootAccessKeyId: 'AKIAROOT',
    rootSecretAccessKey: 'secret',
    region: 'us-east-1',
  };
  const ctrl = new ObjectsAdminController(
    objects as unknown as ObjectService,
    audit as unknown as AuditService,
    config as unknown as AppConfigService,
  );
  return { objects, audit, config, ctrl };
}

interface MockRes {
  statusCode: number;
  headers: Record<string, string>;
  body: unknown;
  json: jest.Mock;
  setHeader: jest.Mock;
  status: jest.Mock;
}
function mockRes(): MockRes {
  const res = { statusCode: 200, headers: {}, body: undefined } as MockRes;
  res.json = jest.fn((b: unknown) => ((res.body = b), res));
  res.setHeader = jest.fn((k: string, v: string) => ((res.headers[k] = v), res));
  res.status = jest.fn((c: number) => ((res.statusCode = c), res));
  return res;
}

const reqWith = (path: string, extra: Partial<Request> = {}): Request =>
  ({
    path,
    query: {},
    headers: {},
    user: { username: 'admin' },
    openbucket: { requestId: 'req-1' },
    ...extra,
  }) as unknown as Request;

const objectPath = (bucket: string, encodedKey: string, suffix = ''): string =>
  `/api/admin/buckets/${bucket}/objects/${encodedKey}${suffix}`;

const headRow = (key: string) => ({
  key,
  size: 1,
  etag: 'e',
  contentType: 'text/plain',
  lastModified: new Date('2026-01-01T00:00:00.000Z'),
  storageClass: 'STANDARD',
});

describe('ObjectsAdminController (TEST-0412)', () => {
  it('case 1: list returns the full paginated shape', async () => {
    const { objects, ctrl } = build();
    objects.list.mockResolvedValue({
      contents: [
        {
          key: 'a.txt',
          size: 3,
          etag: 'e',
          lastModified: new Date('2026-01-01T00:00:00.000Z'),
          storageClass: 'STANDARD',
        },
      ],
      commonPrefixes: ['folder/'],
      nextMarker: 'a.txt',
      isTruncated: true,
    });

    const q = { prefix: 'p/', delimiter: '/', marker: 'm', limit: 100 } as ListObjectsQueryDto;
    const res = await ctrl.list('b1', q);

    expect(res).toEqual({
      bucket: 'b1',
      prefix: 'p/',
      delimiter: '/',
      marker: 'm',
      nextMarker: 'a.txt',
      isTruncated: true,
      contents: [
        {
          key: 'a.txt',
          size: 3,
          etag: 'e',
          lastModified: '2026-01-01T00:00:00.000Z',
          storageClass: 'STANDARD',
        },
      ],
      commonPrefixes: ['folder/'],
    });
  });

  it('case 2: list with an omitted prefix yields prefix: ""', async () => {
    const { objects, ctrl } = build();
    objects.list.mockResolvedValue({ contents: [], commonPrefixes: [], isTruncated: false });
    const res = await ctrl.list('b1', { limit: 100 } as ListObjectsQueryDto);
    expect(res.prefix).toBe('');
  });

  it('case 3: GET (metadata) decodes the key exactly once (%2F → /) and returns JSON', async () => {
    const { objects, ctrl } = build();
    objects.head.mockResolvedValue(headRow('folder/b.txt'));
    const res = mockRes();

    await ctrl.get('b1', reqWith(objectPath('b1', 'folder%2Fb.txt', '/meta')), res as unknown as Response);

    expect(objects.head).toHaveBeenCalledTimes(1);
    expect(objects.head).toHaveBeenCalledWith('b1', 'folder/b.txt');
    expect(objects.getObject).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledTimes(1);
    expect((res.body as { key: string; bucket: string }).key).toBe('folder/b.txt');
  });

  it('case 4: GET (metadata) returns 404 when head returns null', async () => {
    const { objects, ctrl } = build();
    objects.head.mockResolvedValue(null);
    const res = mockRes();
    await expect(
      ctrl.get('b1', reqWith(objectPath('b1', 'missing.txt', '/meta')), res as unknown as Response),
    ).rejects.toThrow(NotFoundException);
  });

  it('case 5: a double-encoded key decodes once (%252F → %2F, not /)', async () => {
    const { objects, ctrl } = build();
    objects.head.mockResolvedValue(headRow('a%2Fb'));
    const res = mockRes();
    await ctrl.get('b1', reqWith(objectPath('b1', 'a%252Fb', '/meta')), res as unknown as Response);
    expect(objects.head).toHaveBeenCalledWith('b1', 'a%2Fb');
  });

  it('case 6: GET ?content streams via getObject (no metadata JSON)', async () => {
    const { objects, ctrl } = build();
    objects.head.mockResolvedValue(headRow('img.png'));
    objects.getObject.mockResolvedValue(undefined);
    const res = mockRes();
    const req = reqWith(objectPath('b1', 'img.png'), { query: { content: '' } as Request['query'] });

    await ctrl.get('b1', req, res as unknown as Response);

    expect(objects.getObject).toHaveBeenCalledWith(req, res, 'b1', 'img.png');
    expect(res.json).not.toHaveBeenCalled();
    expect(res.setHeader).not.toHaveBeenCalledWith('Content-Disposition', expect.anything());
    // TASK-3304: previewed bytes must never be cached (multi-operator installs).
    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'private, no-store');
  });

  it('case 6b: GET ?download does NOT set the no-store Cache-Control (attachment path)', async () => {
    const { objects, ctrl } = build();
    objects.head.mockResolvedValue(headRow('report.pdf'));
    const res = mockRes();
    const req = reqWith(objectPath('b1', 'report.pdf'), {
      query: { download: '' } as Request['query'],
    });

    await ctrl.get('b1', req, res as unknown as Response);

    expect(res.setHeader).not.toHaveBeenCalledWith('Cache-Control', expect.anything());
  });

  it('case 7: GET ?download sets Content-Disposition (basename) and streams', async () => {
    const { objects, ctrl } = build();
    objects.head.mockResolvedValue(headRow('folder/report.pdf'));
    const res = mockRes();
    const req = reqWith(objectPath('b1', 'folder%2Freport.pdf'), {
      query: { download: '' } as Request['query'],
    });

    await ctrl.get('b1', req, res as unknown as Response);

    expect(res.setHeader).toHaveBeenCalledWith(
      'Content-Disposition',
      'attachment; filename="report.pdf"',
    );
    expect(objects.getObject).toHaveBeenCalledWith(req, res, 'b1', 'folder/report.pdf');
  });

  it('case 8: GET ?content returns 404 when the object is absent', async () => {
    const { objects, ctrl } = build();
    objects.head.mockResolvedValue(null);
    const res = mockRes();
    const req = reqWith(objectPath('b1', 'gone.bin'), { query: { content: '' } as Request['query'] });
    await expect(ctrl.get('b1', req, res as unknown as Response)).rejects.toThrow(NotFoundException);
    expect(objects.getObject).not.toHaveBeenCalled();
  });

  it('case 9: upload streams to putFromStream, sets ETag + version, emits object.uploaded', async () => {
    const { objects, audit, ctrl } = build();
    objects.putFromStream.mockResolvedValue({ etag: 'abc123', versionId: 'v1' });
    const res = mockRes();
    const req = reqWith(objectPath('b1', 'folder%2Fnew.txt'), {
      headers: { 'content-type': 'text/plain' },
    });

    const out = await ctrl.upload('b1', req, res as unknown as Response);

    expect(objects.putFromStream).toHaveBeenCalledWith('b1', 'folder/new.txt', req, 'text/plain');
    expect(res.setHeader).toHaveBeenCalledWith('ETag', '"abc123"');
    expect(res.setHeader).toHaveBeenCalledWith('x-amz-version-id', 'v1');
    expect(out).toEqual({ key: 'folder/new.txt', etag: 'abc123' });
    expect(audit.emit).toHaveBeenCalledWith({
      event: 'object.uploaded',
      subject: 'admin',
      bucket: 'b1',
      key: 'folder/new.txt',
      requestId: 'req-1',
    });
  });

  it('case 10: delete calls delete(decoded) and emits object.deleted', async () => {
    const { objects, audit, ctrl } = build();
    objects.delete.mockResolvedValue(undefined);

    await ctrl.delete('b1', reqWith(objectPath('b1', 'folder%2Fb.txt')));

    expect(objects.delete).toHaveBeenCalledWith('b1', 'folder/b.txt');
    expect(audit.emit).toHaveBeenCalledWith({
      event: 'object.deleted',
      subject: 'admin',
      bucket: 'b1',
      key: 'folder/b.txt',
      requestId: 'req-1',
    });
  });
});

describe('ObjectsAdminController sub-resources (STORY-0612)', () => {
  it('batchDelete maps deleteOne per key, returns {deleted,errors}, audits each', async () => {
    const { objects, audit, ctrl } = build();
    objects.deleteOne.mockResolvedValue({});
    const dto = { keys: [{ key: 'a.txt' }, { key: 'b.txt' }] } as BulkDeleteDto;

    const res = await ctrl.batchDelete('b1', dto, reqWith(''));

    expect(objects.deleteOne).toHaveBeenCalledWith('b1', 'a.txt', undefined);
    expect(objects.deleteOne).toHaveBeenCalledWith('b1', 'b.txt', undefined);
    expect(res).toEqual({ deleted: [{ key: 'a.txt' }, { key: 'b.txt' }], errors: [] });
    expect(audit.emit).toHaveBeenCalledTimes(2);
  });

  it('batchDelete records a failed key in errors (no throw)', async () => {
    const { objects, ctrl } = build();
    objects.deleteOne.mockImplementation((_b: string, key: string) =>
      key === 'bad' ? Promise.reject(new Error('boom')) : Promise.resolve({}),
    );
    const dto = { keys: [{ key: 'ok' }, { key: 'bad' }] } as BulkDeleteDto;

    const res = await ctrl.batchDelete('b1', dto, reqWith(''));

    expect(res.deleted).toEqual([{ key: 'ok' }]);
    expect(res.errors).toHaveLength(1);
    expect(res.errors[0]).toMatchObject({ key: 'bad', code: 'InternalError' });
  });

  it('listVersions delegates to listVersionsJson(bucket, query)', async () => {
    const { objects, ctrl } = build();
    const page = { versions: [], deleteMarkers: [], isTruncated: false };
    objects.listVersionsJson.mockResolvedValue(page);
    const q = { prefix: 'p/', maxKeys: 100 } as ObjectVersionsQueryDto;

    const res = await ctrl.listVersions('b1', q);

    expect(objects.listVersionsJson).toHaveBeenCalledWith('b1', {
      prefix: 'p/',
      keyMarker: undefined,
      versionIdMarker: undefined,
      maxKeys: 100,
    });
    expect(res).toBe(page);
  });

  it('object tagging: get returns {tags}; put/delete map + audit', async () => {
    const { objects, audit, ctrl } = build();
    objects.getTaggingMap.mockResolvedValue({ k: 'v' });

    expect(await ctrl.getObjectTagging('b1', 'a/b.txt')).toEqual({ tags: { k: 'v' } });

    await ctrl.putObjectTagging('b1', 'a/b.txt', { tags: { k: 'v' } } as ObjectTaggingDto, reqWith(''));
    expect(objects.setTaggingMap).toHaveBeenCalledWith('b1', 'a/b.txt', { k: 'v' });
    expect(audit.emit).toHaveBeenCalledWith({
      event: 'object.tagging.changed',
      subject: 'admin',
      bucket: 'b1',
      key: 'a/b.txt',
      requestId: 'req-1',
    });

    await ctrl.deleteObjectTagging('b1', 'a/b.txt', reqWith(''));
    expect(objects.clearTaggingMap).toHaveBeenCalledWith('b1', 'a/b.txt');
  });

  it('retention: get returns config; put maps + audit', async () => {
    const { objects, audit, ctrl } = build();
    const r = { mode: 'GOVERNANCE', retainUntil: '2030-01-01T00:00:00.000Z' };
    objects.getRetentionJson.mockResolvedValue(r);

    expect(await ctrl.getObjectRetention('b1', 'k')).toEqual(r);

    await ctrl.putObjectRetention('b1', 'k', r as RetentionDto, reqWith(''));
    expect(objects.setRetention).toHaveBeenCalledWith('b1', 'k', 'GOVERNANCE', '2030-01-01T00:00:00.000Z');
    expect(audit.emit).toHaveBeenCalledWith({
      event: 'object.retention.changed',
      subject: 'admin',
      bucket: 'b1',
      key: 'k',
      requestId: 'req-1',
    });
  });

  it('legal-hold: get returns status; put maps ON->true + audit', async () => {
    const { objects, audit, ctrl } = build();
    objects.getLegalHoldStatus.mockResolvedValue({ status: 'OFF' });

    expect(await ctrl.getObjectLegalHold('b1', 'k')).toEqual({ status: 'OFF' });

    await ctrl.putObjectLegalHold('b1', 'k', { status: 'ON' } as LegalHoldDto, reqWith(''));
    expect(objects.setLegalHold).toHaveBeenCalledWith('b1', 'k', true);
    expect(audit.emit).toHaveBeenCalledWith({
      event: 'object.legalhold.changed',
      subject: 'admin',
      bucket: 'b1',
      key: 'k',
      requestId: 'req-1',
    });
  });

  it('presign caps expiresIn at MAX_EXPIRES and the URL verifies (sign/verify round-trip)', async () => {
    const { ctrl, audit } = build();
    const req = reqWith('', {
      headers: { host: 'localhost:9000' },
      protocol: 'http',
    } as Partial<Request>);

    const res = await ctrl.presignObject(
      'mybucket',
      'a/b.txt',
      { expiresIn: 999_999_999 } as PresignRequestDto,
      req,
    );

    const u = new URL(res.url);
    expect(u.searchParams.get('X-Amz-Expires')).toBe(String(MAX_EXPIRES));
    expect(audit.emit).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'object.presigned', bucket: 'mybucket', key: 'a/b.txt' }),
    );

    const verifyReq = {
      method: 'GET',
      originalUrl: u.pathname + u.search,
      query: Object.fromEntries(u.searchParams) as Record<string, string>,
      headers: { host: 'localhost:9000' },
      openbucket: {},
    } as unknown as Request;
    const keys = {
      getSecret: jest.fn().mockResolvedValue({ accessKeyId: 'AKIAROOT', secretAccessKey: 'secret' }),
    } as unknown as KeyService;
    const verifier = {
      constantTimeEquals: (a: string, b: string) => a === b,
    } as unknown as Sigv4Verifier;

    expect(await verifyPresigned(verifyReq, keys, verifier)).toBe(true);
  });
});
