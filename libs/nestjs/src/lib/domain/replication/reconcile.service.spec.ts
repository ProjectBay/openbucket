import { ConflictException } from '@nestjs/common';
import { MikroORM } from '@mikro-orm/libsql';
import { ReflectMetadataProvider } from '@mikro-orm/core';

import { ReconcileJob } from '../../persistence/index';
import type { Clock } from '../../common/clock/clock';
import { ReconcileService } from './reconcile.service';

/**
 * TEST-0902 — ReconcileService single-flight + lifecycle. Real in-memory ORM so
 * the `active_flag` unique index actually enforces at-most-one active job.
 */
const NOW = Date.parse('2026-07-05T12:00:00.000Z');
const clock: Clock = { nowMs: () => NOW, now: () => new Date(NOW) } as Clock;

describe('ReconcileService (TEST-0902)', () => {
  let orm: MikroORM;

  beforeAll(async () => {
    orm = await MikroORM.init({
      dbName: ':memory:',
      entities: [ReconcileJob],
      metadataProvider: ReflectMetadataProvider,
      metadataCache: { enabled: false },
      allowGlobalContext: true,
      forceUtcTimezone: true,
    });
    await orm.schema.createSchema();
  }, 60_000);

  afterAll(async () => {
    await orm?.close(true);
  });

  beforeEach(async () => {
    await orm.schema.clearDatabase();
  });

  it('case: start inserts a queued job with the active flag', async () => {
    const svc = new ReconcileService(orm.em.fork() as never, clock);
    const job = await svc.start({ scope: 'instance', subject: 'admin' });
    expect(job.state).toBe('queued');
    expect(job.scope).toBe('instance');
    expect(job.activeFlag).toBe('active');
    expect(job.subject).toBe('admin');
  });

  it('case: a second start while a job is active throws ConflictException', async () => {
    const svc = new ReconcileService(orm.em.fork() as never, clock);
    await svc.start({ scope: 'instance', subject: 'admin' });
    await expect(svc.start({ scope: 'bucket', bucket: 'b', subject: 'admin' })).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('case: concurrent start() calls yield exactly one queued job', async () => {
    const svc = new ReconcileService(orm.em.fork() as never, clock);
    const results = await Promise.allSettled([
      svc.start({ scope: 'instance', subject: 'a' }),
      svc.start({ scope: 'instance', subject: 'b' }),
      svc.start({ scope: 'instance', subject: 'c' }),
    ]);
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(2);
    for (const r of rejected) {
      expect((r as PromiseRejectedResult).reason).toBeInstanceOf(ConflictException);
    }
    const count = await orm.em.fork().count(ReconcileJob, { state: 'queued' });
    expect(count).toBe(1);
  });

  it('case: a new job may start once the previous one is terminal', async () => {
    const svc = new ReconcileService(orm.em.fork() as never, clock);
    const first = await svc.start({ scope: 'instance', subject: 'admin' });
    await svc.markTerminal(first, 'completed');
    expect(first.activeFlag).toBeNull();

    // Reload in a fresh EM to prove the flag was cleared in the DB.
    const svc2 = new ReconcileService(orm.em.fork() as never, clock);
    const second = await svc2.start({ scope: 'bucket', bucket: 'b', subject: 'admin' });
    expect(second.state).toBe('queued');
    expect(await orm.em.fork().count(ReconcileJob)).toBe(2);
  });

  it('case: claimNext marks the queued job running and stamps startedAt', async () => {
    const svc = new ReconcileService(orm.em.fork() as never, clock);
    await svc.start({ scope: 'instance', subject: 'admin' });

    const svc2 = new ReconcileService(orm.em.fork() as never, clock);
    const claimed = await svc2.claimNext();
    expect(claimed).not.toBeNull();
    expect(claimed!.state).toBe('running');
    expect(claimed!.startedAt?.getTime()).toBe(NOW);
  });

  it('case: markTerminal failed stores a bounded error and clears the flag', async () => {
    const svc = new ReconcileService(orm.em.fork() as never, clock);
    const job = await svc.start({ scope: 'instance', subject: 'admin' });
    await svc.markTerminal(job, 'failed', 'remote unreachable');
    expect(job.state).toBe('failed');
    expect(job.error).toBe('remote unreachable');
    expect(job.finishedAt?.getTime()).toBe(NOW);
    expect(job.activeFlag).toBeNull();
  });
});
