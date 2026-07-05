import { Logger } from '@nestjs/common';

import type { Clock } from '../clock/clock';
import type { ObjectService } from '../../domain/objects/object.service';
import type { ReplicationOutbox } from '../../persistence/entities/replication-outbox.entity';
import type { ReplicationOutboxRepository } from '../../persistence/repositories/replication-outbox.repository';
import type { ReplicationConfig } from '../../storage/replication/replication-config';
import type { ReplicationTargetService } from '../../storage/replication/replication-target.service';
import { ReplicationWorkerRunner } from './replication.runner';

/**
 * TEST-0900 — replication drain worker: coalescing (last-writer-wins per key),
 * exponential-backoff retry, dead-letter cap, and the disabled no-op path.
 */
const NOW = Date.parse('2026-07-04T12:00:00.000Z');
const BUCKET = 'b';
const KEY = 'k';

let seq = 0n;
function makeIntent(over: Partial<ReplicationOutbox> = {}): ReplicationOutbox {
  return {
    id: `intent-${seq}`,
    seq: seq++,
    bucket: { name: BUCKET } as ReplicationOutbox['bucket'],
    key: KEY,
    op: 'PUT',
    status: 'pending',
    attempts: 0,
    nextAttemptAt: new Date(NOW - 1000),
    createdAt: new Date(NOW - 1000),
    updatedAt: new Date(NOW - 1000),
    ...over,
  } as ReplicationOutbox;
}

function makeConfig(over: Partial<ReplicationConfig> = {}): ReplicationConfig {
  return {
    enabled: true,
    region: 'us-east-1',
    bucket: 'remote',
    accessKeyId: 'AK',
    secretAccessKey: 'SK',
    forcePathStyle: true,
    maxAttempts: 3,
    drainIntervalMs: 5_000,
    batchKeys: 50,
    largeObjectThresholdBytes: 64 * 1024 * 1024,
    ...over,
  };
}

function makeRepo(chain: ReplicationOutbox[]) {
  const flush = jest.fn().mockResolvedValue(undefined);
  const deleteDoneForKey = jest.fn().mockResolvedValue(chain.length);
  const dueKeys = jest
    .fn()
    .mockResolvedValue(chain.length ? [{ bucket: BUCKET, key: KEY }] : []);
  const pendingForKey = jest.fn().mockResolvedValue(chain);
  const repo = {
    dueKeys,
    pendingForKey,
    deleteDoneForKey,
    getEntityManager: () => ({ flush }),
  } as unknown as ReplicationOutboxRepository;
  return { repo, flush, deleteDoneForKey, dueKeys, pendingForKey };
}

function makeTarget() {
  return {
    putObject: jest.fn().mockResolvedValue(undefined),
    deleteObject: jest.fn().mockResolvedValue(undefined),
  } as unknown as ReplicationTargetService & {
    putObject: jest.Mock;
    deleteObject: jest.Mock;
  };
}

function makeObjects(stream: unknown = { destroy: jest.fn() }, present = true) {
  return {
    openObjectStream: jest.fn().mockResolvedValue(
      present
        ? { stream, size: 3, contentType: 'text/plain', etag: 'e', lastModified: new Date(NOW) }
        : null,
    ),
  } as unknown as ObjectService & { openObjectStream: jest.Mock };
}

const clock: Clock = { nowMs: () => NOW, now: () => new Date(NOW) } as Clock;

describe('ReplicationWorkerRunner (TEST-0900)', () => {
  beforeEach(() => {
    seq = 0n;
    jest.spyOn(Math, 'random').mockReturnValue(0.5); // deterministic jitter
  });
  afterEach(() => jest.restoreAllMocks());

  it('case: coalesces PUT,PUT into a single remote PUT and clears the chain', async () => {
    const chain = [makeIntent({ op: 'PUT' }), makeIntent({ op: 'PUT' })];
    const { repo, flush, deleteDoneForKey } = makeRepo(chain);
    const target = makeTarget();
    const objects = makeObjects();
    const runner = new ReplicationWorkerRunner(makeConfig(), repo, target, objects, clock);

    await runner.run();

    expect(target.putObject).toHaveBeenCalledTimes(1);
    expect(objects.openObjectStream).toHaveBeenCalledTimes(1);
    expect(chain.every((i) => i.status === 'done')).toBe(true);
    expect(flush).toHaveBeenCalled();
    expect(deleteDoneForKey).toHaveBeenCalledWith(BUCKET, KEY);
  });

  it('case: coalesces PUT,DELETE into a single remote DELETE (no PUT)', async () => {
    const chain = [makeIntent({ op: 'PUT' }), makeIntent({ op: 'DELETE' })];
    const { repo, deleteDoneForKey } = makeRepo(chain);
    const target = makeTarget();
    const objects = makeObjects();
    const runner = new ReplicationWorkerRunner(makeConfig(), repo, target, objects, clock);

    await runner.run();

    expect(target.deleteObject).toHaveBeenCalledTimes(1);
    expect(target.deleteObject).toHaveBeenCalledWith(KEY);
    expect(target.putObject).not.toHaveBeenCalled();
    expect(chain.every((i) => i.status === 'done')).toBe(true);
    expect(deleteDoneForKey).toHaveBeenCalled();
  });

  it('case: last PUT whose object was since deleted is a no-op success', async () => {
    const chain = [makeIntent({ op: 'PUT' })];
    const { repo, deleteDoneForKey } = makeRepo(chain);
    const target = makeTarget();
    const objects = makeObjects(undefined, /* present */ false);
    const runner = new ReplicationWorkerRunner(makeConfig(), repo, target, objects, clock);

    await runner.run();

    expect(target.putObject).not.toHaveBeenCalled();
    expect(chain[0].status).toBe('done');
    expect(deleteDoneForKey).toHaveBeenCalled();
  });

  it('case: a failed send keeps the intent pending, bumps attempts, advances backoff', async () => {
    const chain = [makeIntent({ op: 'PUT' })];
    const { repo, flush, deleteDoneForKey } = makeRepo(chain);
    const target = makeTarget();
    (target.putObject as jest.Mock).mockRejectedValue(new Error('remote down'));
    const objects = makeObjects();
    const runner = new ReplicationWorkerRunner(makeConfig(), repo, target, objects, clock);

    await runner.run();

    expect(chain[0].status).toBe('pending');
    expect(chain[0].attempts).toBe(1);
    expect(chain[0].lastError).toBe('remote down');
    expect(chain[0].nextAttemptAt.getTime()).toBeGreaterThan(NOW);
    expect(flush).toHaveBeenCalled();
    expect(deleteDoneForKey).not.toHaveBeenCalled();
  });

  it('case: the source stream is destroyed when the PUT send fails (no fd leak)', async () => {
    const destroy = jest.fn();
    const chain = [makeIntent({ op: 'PUT' })];
    const { repo } = makeRepo(chain);
    const target = makeTarget();
    (target.putObject as jest.Mock).mockRejectedValue(new Error('boom'));
    const objects = makeObjects({ destroy });
    const runner = new ReplicationWorkerRunner(makeConfig(), repo, target, objects, clock);

    await runner.run();

    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it('case: after maxAttempts a permanently-failing intent is dead-lettered to failed', async () => {
    const chain = [makeIntent({ op: 'PUT', attempts: 2 })]; // maxAttempts 3 → this reaches it
    const { repo } = makeRepo(chain);
    const target = makeTarget();
    (target.putObject as jest.Mock).mockRejectedValue(new Error('perms revoked'));
    const objects = makeObjects();
    const runner = new ReplicationWorkerRunner(makeConfig(), repo, target, objects, clock);

    await runner.run();

    expect(chain[0].attempts).toBe(3);
    expect(chain[0].status).toBe('failed');
  });

  it('case: earlier superseded intents are marked done even when the last send fails', async () => {
    const chain = [makeIntent({ op: 'PUT' }), makeIntent({ op: 'PUT' })];
    const { repo } = makeRepo(chain);
    const target = makeTarget();
    (target.putObject as jest.Mock).mockRejectedValue(new Error('nope'));
    const objects = makeObjects();
    const runner = new ReplicationWorkerRunner(makeConfig(), repo, target, objects, clock);

    await runner.run();

    expect(chain[0].status).toBe('done'); // superseded regardless of outcome
    expect(chain[1].status).toBe('pending'); // the last one is retried
    expect(chain[1].attempts).toBe(1);
  });

  it('case: replication disabled → no due-scan, no remote calls', async () => {
    const { repo, dueKeys } = makeRepo([]);
    const target = makeTarget();
    const objects = makeObjects();
    const runner = new ReplicationWorkerRunner(
      makeConfig({ enabled: false }),
      repo,
      target,
      objects,
      clock,
    );

    await runner.run();

    expect(dueKeys).not.toHaveBeenCalled();
    expect(target.putObject).not.toHaveBeenCalled();
    expect(target.deleteObject).not.toHaveBeenCalled();
  });

  it('case: a per-key error is isolated and never rejects the tick', async () => {
    const { repo, pendingForKey } = makeRepo([makeIntent()]);
    (pendingForKey as jest.Mock).mockRejectedValue(new Error('db blew up'));
    const target = makeTarget();
    const objects = makeObjects();
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const runner = new ReplicationWorkerRunner(makeConfig(), repo, target, objects, clock);

    await expect(runner.run()).resolves.toBeUndefined();
  });

  it('case: intervalMs is sourced from config.drainIntervalMs', () => {
    const { repo } = makeRepo([]);
    const runner = new ReplicationWorkerRunner(
      makeConfig({ drainIntervalMs: 12_345 }),
      repo,
      makeTarget(),
      makeObjects(),
      clock,
    );
    expect(runner.intervalMs).toBe(12_345);
    expect(runner.name).toBe('replication-drain');
  });
});
