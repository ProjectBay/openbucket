import { Logger } from '@nestjs/common';
import type { EntityManager } from '@mikro-orm/core';

import type { AppConfigService } from '../../common/config/app-config.service';
import type { Bucket } from '../../persistence/index';
import { ReplicationOutbox } from '../../persistence/index';
import { resolveReplicationConfig, type ReplicationConfig } from './replication-config';
import {
  ReplicationOutboxService,
  nextReplicationSeq,
} from './replication-outbox.service';

/** TEST-0900 — the transactional-outbox enqueue seam + config resolution. */

function makeEm() {
  const created: Array<Record<string, unknown>> = [];
  const persist = jest.fn();
  const em = {
    create: (_entity: unknown, data: Record<string, unknown>) => {
      created.push(data);
      return data;
    },
    persist,
  } as unknown as EntityManager;
  return { em, created, persist };
}

const bucket = { name: 'b' } as Bucket;

describe('ReplicationOutboxService.enqueue (TEST-0900)', () => {
  it('case: no-op when replication is disabled (empty outbox, zero cost)', () => {
    const svc = new ReplicationOutboxService({ enabled: false } as ReplicationConfig);
    const { em, persist } = makeEm();

    svc.enqueue(em, { bucket, key: 'k', op: 'PUT' });

    expect(persist).not.toHaveBeenCalled();
    expect(svc.enabled).toBe(false);
  });

  it('case: persists a pending PUT intent on the caller EM when enabled', () => {
    const svc = new ReplicationOutboxService({ enabled: true } as ReplicationConfig);
    const { em, persist, created } = makeEm();

    svc.enqueue(em, {
      bucket,
      key: 'k',
      op: 'PUT',
      versionId: 'v1',
      etag: 'e',
      size: 3n,
      contentType: 'text/plain',
    });

    expect(persist).toHaveBeenCalledTimes(1);
    const row = created[0];
    expect(row.op).toBe('PUT');
    expect(row.status).toBe('pending');
    expect(row.attempts).toBe(0);
    expect(row.key).toBe('k');
    expect(row.versionId).toBe('v1');
    expect(row.etag).toBe('e');
    expect(row.size).toBe(3n);
    expect(typeof row.id).toBe('string');
    expect(typeof row.seq).toBe('bigint');
  });

  it('case: enqueues a DELETE intent (visible-state reflection)', () => {
    const svc = new ReplicationOutboxService({ enabled: true } as ReplicationConfig);
    const { em, created } = makeEm();

    svc.enqueue(em, { bucket, key: 'gone', op: 'DELETE' });

    expect(created[0].op).toBe('DELETE');
    expect(created[0].key).toBe('gone');
  });

  it('constructs a real ReplicationOutbox entity (create is the entity ctor)', () => {
    // Sanity: the entity class is importable and its status default is pending.
    const row = new ReplicationOutbox();
    expect(row.status).toBe('pending');
    expect(row.attempts).toBe(0);
  });
});

describe('nextReplicationSeq (TEST-0900)', () => {
  it('is strictly increasing even at the same millisecond', () => {
    const a = nextReplicationSeq(1_000);
    const b = nextReplicationSeq(1_000);
    const c = nextReplicationSeq(1_000);
    expect(b).toBeGreaterThan(a);
    expect(c).toBeGreaterThan(b);
  });

  it('advances with the wall clock', () => {
    const a = nextReplicationSeq(2_000);
    const b = nextReplicationSeq(3_000);
    expect(b).toBeGreaterThan(a);
  });
});

describe('resolveReplicationConfig (TEST-0900)', () => {
  function cfg(over: Partial<Record<string, unknown>> = {}): AppConfigService {
    return {
      replicationEnabled: false,
      replicationEndpoint: undefined,
      replicationRegion: 'us-east-1',
      replicationBucket: undefined,
      replicationAccessKeyId: undefined,
      replicationSecretAccessKey: undefined,
      replicationForcePathStyle: true,
      replicationMaxAttempts: 12,
      replicationDrainIntervalMs: 5_000,
      replicationBatchKeys: 50,
      replicationLargeObjectThresholdBytes: 64 * 1024 * 1024,
      ...over,
    } as unknown as AppConfigService;
  }

  it('case: returns { enabled: false } when replication is unset', () => {
    expect(resolveReplicationConfig(cfg()).enabled).toBe(false);
  });

  it('case: resolves the full shape when enabled', () => {
    const resolved = resolveReplicationConfig(
      cfg({
        replicationEnabled: true,
        replicationEndpoint: 'https://s3.example.com',
        replicationBucket: 'remote',
        replicationAccessKeyId: 'AK',
        replicationSecretAccessKey: 'SK',
      }),
    );
    expect(resolved.enabled).toBe(true);
    expect(resolved.endpoint).toBe('https://s3.example.com');
    expect(resolved.bucket).toBe('remote');
    expect(resolved.maxAttempts).toBe(12);
  });

  it('case: an http:// endpoint logs a boot-time warning (plaintext leak)', () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    resolveReplicationConfig(
      cfg({
        replicationEnabled: true,
        replicationEndpoint: 'http://minio.local:9000',
        replicationBucket: 'remote',
        replicationAccessKeyId: 'AK',
        replicationSecretAccessKey: 'SK',
      }),
    );
    expect(warn).toHaveBeenCalled();
    expect((warn.mock.calls[0][0] as string)).toContain('http://');
    warn.mockRestore();
  });

  it('case: an https:// endpoint does not warn', () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    resolveReplicationConfig(
      cfg({
        replicationEnabled: true,
        replicationEndpoint: 'https://s3.example.com',
        replicationBucket: 'remote',
        replicationAccessKeyId: 'AK',
        replicationSecretAccessKey: 'SK',
      }),
    );
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});
