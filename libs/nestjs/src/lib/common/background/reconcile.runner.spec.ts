import { Logger } from '@nestjs/common';

import type { ObjectService } from '../../domain/objects/object.service';
import type { ReconcileService } from '../../domain/replication/reconcile.service';
import type { ReconcileJob } from '../../persistence/entities/reconcile-job.entity';
import type { BucketRepository } from '../../persistence/repositories/bucket.repository';
import type { ReplicationConfig } from '../../storage/replication/replication-config';
import type { ReplicationOutboxService } from '../../storage/replication/replication-outbox.service';
import type { ReplicationTargetService } from '../../storage/replication/replication-target.service';
import type { AuditService } from '../../admin/audit/audit.service';
import { BATCH_SIZE, MAX_BATCHES_PER_TICK, ReconcileRunner } from './reconcile.runner';

/**
 * TEST-0902 — ReconcileRunner: diff/idempotency, key-codec matching, cursor
 * resume, and redacted remote-failure handling. Collaborators are mocked; the
 * enqueue transaction is a pass-through.
 */
function makeConfig(over: Partial<ReplicationConfig> = {}): ReplicationConfig {
  return {
    enabled: true,
    endpoint: 'https://secret-endpoint.example.com',
    region: 'us-east-1',
    bucket: 'remote-secret-bucket',
    accessKeyId: 'AKIA-SECRET',
    secretAccessKey: 'SK-SECRET',
    forcePathStyle: true,
    maxAttempts: 12,
    drainIntervalMs: 5_000,
    batchKeys: 50,
    largeObjectThresholdBytes: 64 * 1024 * 1024,
    ...over,
  };
}

function makeJob(over: Partial<ReconcileJob> = {}): ReconcileJob {
  return {
    id: 'job-1',
    scope: 'instance',
    state: 'running',
    localScanned: 0,
    remoteScanned: 0,
    missingRequeued: 0,
    subject: 'admin',
    createdAt: new Date(),
    ...over,
  } as ReconcileJob;
}

function localItem(key: string, size = 1) {
  return { key, size, etag: 'e', lastModified: new Date(), storageClass: 'STANDARD', location: 'local' };
}

interface Harness {
  runner: ReconcileRunner;
  reconcile: { claimNext: jest.Mock; persistProgress: jest.Mock; markTerminal: jest.Mock };
  objects: { list: jest.Mock };
  target: { listRemoteObjects: jest.Mock };
  outbox: { enqueue: jest.Mock };
  audit: { emit: jest.Mock };
  em: { transactional: jest.Mock };
}

function harness(job: ReconcileJob | null, opts: { buckets?: string[]; config?: Partial<ReplicationConfig> } = {}): Harness {
  const reconcile = {
    claimNext: jest.fn().mockResolvedValue(job),
    persistProgress: jest.fn().mockResolvedValue(undefined),
    markTerminal: jest.fn().mockResolvedValue(undefined),
  };
  const objects = { list: jest.fn() };
  const target = { listRemoteObjects: jest.fn().mockResolvedValue({ objects: [], isTruncated: false }) };
  const outbox = { enqueue: jest.fn() };
  const audit = { emit: jest.fn() };
  const em = { transactional: jest.fn(async (cb: (tem: unknown) => unknown) => cb({ getReference: () => ({}) })) };
  const buckets = { listAll: jest.fn().mockResolvedValue((opts.buckets ?? ['a']).map((name) => ({ name }))) };

  const runner = new ReconcileRunner(
    em as never,
    makeConfig(opts.config),
    reconcile as unknown as ReconcileService,
    objects as unknown as ObjectService,
    buckets as unknown as BucketRepository,
    target as unknown as ReplicationTargetService,
    outbox as unknown as ReplicationOutboxService,
    audit as unknown as AuditService,
  );
  return { runner, reconcile, objects, target, outbox, audit, em };
}

describe('ReconcileRunner (TEST-0902)', () => {
  afterEach(() => jest.restoreAllMocks());

  it('case: replication disabled → no claim, no work', async () => {
    const h = harness(makeJob(), { config: { enabled: false } });
    await h.runner.run();
    expect(h.reconcile.claimNext).not.toHaveBeenCalled();
  });

  it('case: no active job → no-op tick', async () => {
    const h = harness(null);
    await h.runner.run();
    expect(h.objects.list).not.toHaveBeenCalled();
    expect(h.reconcile.markTerminal).not.toHaveBeenCalled();
  });

  it('case: requeues exactly the N of M objects missing on the remote; completes + audits', async () => {
    const job = makeJob();
    const h = harness(job);
    // 3 local objects; the remote has only k1.
    h.objects.list
      .mockResolvedValueOnce({ contents: [localItem('k1'), localItem('k2'), localItem('k3')] })
      .mockResolvedValue({ contents: [] });
    h.target.listRemoteObjects.mockResolvedValue({ objects: [{ key: 'k1', size: 1 }], isTruncated: false });

    await h.runner.run();

    expect(h.outbox.enqueue).toHaveBeenCalledTimes(2); // k2, k3
    expect(job.missingRequeued).toBe(2);
    expect(job.localScanned).toBe(3);
    expect(h.reconcile.markTerminal).toHaveBeenCalledWith(job, 'completed');
    expect(h.audit.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'replication.reconcile.completed',
        jobId: 'job-1',
        missingRequeued: 2,
        localScanned: 3,
      }),
    );
  });

  it('case: idempotent — when the remote has every local object, requeues 0', async () => {
    const job = makeJob();
    const h = harness(job);
    h.objects.list
      .mockResolvedValueOnce({ contents: [localItem('k1'), localItem('k2')] })
      .mockResolvedValue({ contents: [] });
    h.target.listRemoteObjects.mockResolvedValue({
      objects: [{ key: 'k1', size: 1 }, { key: 'k2', size: 1 }],
      isTruncated: false,
    });

    await h.runner.run();

    expect(h.outbox.enqueue).not.toHaveBeenCalled();
    expect(job.missingRequeued).toBe(0);
    expect(h.reconcile.markTerminal).toHaveBeenCalledWith(job, 'completed');
  });

  it('case: keys with / UTF-8 and %XX are matched via decodeKey and not double-requeued', async () => {
    const job = makeJob();
    const h = harness(job);
    const keys = ['a/b', 'îmage', 'a%2Fb'];
    h.objects.list
      .mockResolvedValueOnce({ contents: keys.map((k) => localItem(k)) })
      .mockResolvedValue({ contents: [] });
    // Remote returns the SAME raw keys; both sides decode consistently → all match.
    h.target.listRemoteObjects.mockResolvedValue({
      objects: keys.map((k) => ({ key: k, size: 1 })),
      isTruncated: false,
    });

    await h.runner.run();

    expect(h.outbox.enqueue).not.toHaveBeenCalled();
    expect(job.missingRequeued).toBe(0);
  });

  it('case: a size divergence re-queues the object', async () => {
    const job = makeJob();
    const h = harness(job);
    h.objects.list
      .mockResolvedValueOnce({ contents: [localItem('k1', 100)] })
      .mockResolvedValue({ contents: [] });
    h.target.listRemoteObjects.mockResolvedValue({ objects: [{ key: 'k1', size: 42 }], isTruncated: false });

    await h.runner.run();

    expect(h.outbox.enqueue).toHaveBeenCalledTimes(1);
    expect(job.missingRequeued).toBe(1);
  });

  it('case: a run over the per-tick cap pauses via the cursor without completing', async () => {
    const job = makeJob();
    const h = harness(job);
    let n = 0;
    // Always return a full page so the bucket never exhausts this tick.
    h.objects.list.mockImplementation(async () => {
      const start = n;
      n += BATCH_SIZE;
      return { contents: Array.from({ length: BATCH_SIZE }, (_, i) => localItem(`k${start + i}`)) };
    });

    await h.runner.run();

    expect(h.objects.list).toHaveBeenCalledTimes(MAX_BATCHES_PER_TICK);
    expect(h.reconcile.markTerminal).not.toHaveBeenCalled(); // still running
    expect(job.cursorBucket).toBe('a');
    expect(job.cursorKey).toBeDefined();
  });

  it('case: a remote-list failure fails the job with a redacted message', async () => {
    const job = makeJob();
    const h = harness(job);
    h.objects.list.mockResolvedValue({ contents: [localItem('k1')] });
    h.target.listRemoteObjects.mockRejectedValue(
      new Error('connect ECONNREFUSED https://secret-endpoint.example.com/remote-secret-bucket'),
    );
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

    await h.runner.run();

    expect(h.reconcile.markTerminal).toHaveBeenCalledWith(job, 'failed', expect.any(String));
    const message = h.reconcile.markTerminal.mock.calls[0][2] as string;
    expect(message).not.toContain('secret-endpoint');
    expect(message).not.toContain('remote-secret-bucket');
  });

  it('case: instance scope scans every bucket in sorted order', async () => {
    const job = makeJob({ scope: 'instance' });
    const h = harness(job, { buckets: ['b2', 'b1'] });
    h.objects.list.mockResolvedValue({ contents: [] }); // both buckets empty

    await h.runner.run();

    const listedBuckets = h.objects.list.mock.calls.map((c) => c[0].bucket);
    expect(listedBuckets).toEqual(['b1', 'b2']); // sorted
    expect(h.reconcile.markTerminal).toHaveBeenCalledWith(job, 'completed');
  });
});
