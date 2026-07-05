import { MikroORM } from '@mikro-orm/libsql';
import { ReflectMetadataProvider } from '@mikro-orm/core';
import { v7 as uuidv7 } from 'uuid';

import { AuditLog } from '../../persistence/entities/audit-log.entity';
import { AuditLogRepository } from '../../persistence/repositories/audit-log.repository';
import type { AppConfigService } from '../../common/config/app-config.service';
import { AuditFlushRunner } from './audit-flush.runner';
import { AuditSink } from './audit-sink';

const DAY = 86_400_000;

/**
 * TEST-1103 — AuditFlushRunner (TASK-3331): drains the sink into `audit_logs`
 * (correct column mapping) and runs the once-per-day retention prune.
 */
describe('AuditFlushRunner (TEST-1103)', () => {
  let orm: MikroORM;

  const repo = (): AuditLogRepository =>
    orm.em.fork().getRepository(AuditLog) as unknown as AuditLogRepository;

  beforeAll(async () => {
    orm = await MikroORM.init({
      dbName: ':memory:',
      entities: [AuditLog],
      metadataProvider: ReflectMetadataProvider,
      metadataCache: { enabled: false },
      allowGlobalContext: true,
      forceUtcTimezone: true,
    });
    await orm.schema.createSchema();
  }, 60_000);

  afterEach(async () => {
    await orm.em.fork().nativeDelete(AuditLog, {});
  });

  afterAll(async () => {
    await orm?.close(true);
  });

  const cfg = (over: Partial<AppConfigService> = {}): AppConfigService =>
    ({ auditFlushMs: 2000, auditRetentionDays: 90, ...over }) as AppConfigService;

  it('case 1: run() flushes buffered events with correct column mapping', async () => {
    const sink = new AuditSink();
    sink.record({ event: 'object.deleted', subject: 'admin', bucket: 'b1', key: 'k/obj' });
    const runner = new AuditFlushRunner(sink, repo(), cfg());

    await runner.run();

    const rows = await orm.em.fork().find(AuditLog, {});
    expect(rows).toHaveLength(1);
    expect(rows[0].event).toBe('object.deleted');
    expect(rows[0].objectKey).toBe('k/obj'); // key → object_key
    expect(sink.size).toBe(0);
  });

  it('case 2: intervalMs reflects config', () => {
    const runner = new AuditFlushRunner(new AuditSink(), repo(), cfg({ auditFlushMs: 500 }));
    expect(runner.intervalMs).toBe(500);
  });

  it('case 3: the daily prune removes rows past retention, once per day', async () => {
    // Seed an old row directly.
    const em = orm.em.fork();
    em.create(AuditLog, {
      id: uuidv7(),
      ts: new Date(Date.now() - 200 * DAY),
      event: 'old',
    });
    await em.flush();

    const sink = new AuditSink();
    const pruneSpy = jest.spyOn(AuditLogRepository.prototype, 'pruneOlderThan');
    const runner = new AuditFlushRunner(sink, repo(), cfg({ auditRetentionDays: 90 }));

    await runner.run();
    expect(pruneSpy).toHaveBeenCalledTimes(1);
    const remaining = await orm.em.fork().find(AuditLog, {});
    expect(remaining).toHaveLength(0); // the 200-day-old row is gone

    // Same UTC day → no second prune.
    await runner.run();
    expect(pruneSpy).toHaveBeenCalledTimes(1);
    pruneSpy.mockRestore();
  });
});
