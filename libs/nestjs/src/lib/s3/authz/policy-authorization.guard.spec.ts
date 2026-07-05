import type { ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';

import { PolicyAuthorizationGuard } from './policy-authorization.guard';
import { AccessDeniedError } from '../errors/s3-error';
import { compileScopeToPolicy } from '../../domain/keys/key-scope';
import type { BucketService } from '../../domain/buckets/bucket.service';
import type { PolicyDocument } from '../../persistence/entities/types';

/**
 * TASK-3002 / [TEST-1000] — scope enforcement in PolicyAuthorizationGuard.
 * Matrix: root (unaffected) vs scoped key × in/out of scope, bucket-policy Deny
 * override, service-scope denial, and ListBucket prefix gating.
 */
function ctxFor(req: Request): ExecutionContext {
  return { switchToHttp: () => ({ getRequest: () => req }) } as unknown as ExecutionContext;
}

function mkReq(over: Record<string, unknown>): Request {
  return {
    secure: false,
    ip: '10.0.0.1',
    method: 'GET',
    headers: {},
    query: {},
    openbucket: { kind: 's3', requestId: 'r', receivedAt: 0, ...over },
  } as unknown as Request;
}

const tenantScope = compileScopeToPolicy({ kind: 'prefix', bucket: 't-a', prefix: 'tenant-a/' });

function guardWith(policy: PolicyDocument | null): {
  guard: PolicyAuthorizationGuard;
  buckets: { tryGetPolicyDoc: jest.Mock };
} {
  const buckets = { tryGetPolicyDoc: jest.fn().mockResolvedValue(policy) };
  return { guard: new PolicyAuthorizationGuard(buckets as unknown as BucketService), buckets };
}

describe('PolicyAuthorizationGuard scope enforcement (TASK-3002)', () => {
  it('root key with no policy is allowed (byte-identical to pre-change)', async () => {
    const { guard } = guardWith(null);
    const req = mkReq({
      bucket: 't-a',
      key: 'anything/file',
      operation: 'GetObject',
      accessKeyId: 'AKROOT',
      isRoot: true,
      keyScope: null,
    });
    await expect(guard.canActivate(ctxFor(req))).resolves.toBe(true);
  });

  it('scoped key is allowed for an object INSIDE its prefix', async () => {
    const { guard } = guardWith(null);
    const req = mkReq({
      bucket: 't-a',
      key: 'tenant-a/report.csv',
      operation: 'GetObject',
      accessKeyId: 'AKSUB',
      isRoot: false,
      keyScope: tenantScope,
    });
    await expect(guard.canActivate(ctxFor(req))).resolves.toBe(true);
  });

  it('scoped key is DENIED (403) for an object OUTSIDE its prefix', async () => {
    const { guard } = guardWith(null);
    const req = mkReq({
      bucket: 't-a',
      key: 'tenant-b/secret.csv',
      operation: 'GetObject',
      accessKeyId: 'AKSUB',
      isRoot: false,
      keyScope: tenantScope,
    });
    await expect(guard.canActivate(ctxFor(req))).rejects.toThrow(AccessDeniedError);
  });

  it('scoped key is DENIED for a different bucket entirely', async () => {
    const { guard } = guardWith(null);
    const req = mkReq({
      bucket: 't-b',
      key: 'tenant-a/x',
      operation: 'GetObject',
      accessKeyId: 'AKSUB',
      isRoot: false,
      keyScope: tenantScope,
    });
    await expect(guard.canActivate(ctxFor(req))).rejects.toThrow(AccessDeniedError);
  });

  it('a bucket-policy Deny overrides a scope Allow (deny checked first)', async () => {
    const denyPolicy: PolicyDocument = {
      Version: '2012-10-17',
      Statement: [
        { Effect: 'Deny', Principal: '*', Action: 's3:GetObject', Resource: 'arn:aws:s3:::t-a/*' },
      ],
    };
    const { guard } = guardWith(denyPolicy);
    const req = mkReq({
      bucket: 't-a',
      key: 'tenant-a/inside',
      operation: 'GetObject',
      accessKeyId: 'AKSUB',
      isRoot: false,
      keyScope: tenantScope,
    });
    await expect(guard.canActivate(ctxFor(req))).rejects.toThrow(/bucket policy/);
  });

  it('a scoped key calling ListBuckets (service scope) is denied', async () => {
    const { guard } = guardWith(null);
    const req = mkReq({
      operation: 'ListBuckets',
      accessKeyId: 'AKSUB',
      isRoot: false,
      keyScope: tenantScope,
    });
    await expect(guard.canActivate(ctxFor(req))).rejects.toThrow(AccessDeniedError);
  });

  it('root calling ListBuckets is allowed', async () => {
    const { guard } = guardWith(null);
    const req = mkReq({ operation: 'ListBuckets', accessKeyId: 'AKROOT', isRoot: true, keyScope: null });
    await expect(guard.canActivate(ctxFor(req))).resolves.toBe(true);
  });

  it('ListObjectsV2 with a matching prefix is allowed and with a bad/missing prefix denied', async () => {
    const { guard } = guardWith(null);
    const base = {
      bucket: 't-a',
      operation: 'ListObjectsV2',
      accessKeyId: 'AKSUB',
      isRoot: false,
      keyScope: tenantScope,
    };
    const ok = mkReq(base);
    ok.query = { prefix: 'tenant-a/2024/' } as Request['query'];
    await expect(guard.canActivate(ctxFor(ok))).resolves.toBe(true);

    const noPrefix = mkReq(base);
    await expect(guard.canActivate(ctxFor(noPrefix))).rejects.toThrow(AccessDeniedError);

    const wrongPrefix = mkReq(base);
    wrongPrefix.query = { prefix: 'other/' } as Request['query'];
    await expect(guard.canActivate(ctxFor(wrongPrefix))).rejects.toThrow(AccessDeniedError);
  });

  it('scoped key PUT inside prefix is allowed (write action)', async () => {
    const { guard } = guardWith(null);
    const req = mkReq({
      method: 'PUT',
      bucket: 't-a',
      key: 'tenant-a/upload.bin',
      operation: 'PutObject',
      accessKeyId: 'AKSUB',
      isRoot: false,
      keyScope: tenantScope,
    });
    await expect(guard.canActivate(ctxFor(req))).resolves.toBe(true);
  });
});
