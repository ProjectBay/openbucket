import { BadRequestException } from '@nestjs/common';
import { MikroORM } from '@mikro-orm/libsql';
import { ReflectMetadataProvider } from '@mikro-orm/core';
import { v7 as uuidv7 } from 'uuid';

import { AuditLog } from '../../persistence/entities/audit-log.entity';
import {
  AuditLogRepository,
  type AuditRow,
} from '../../persistence/repositories/audit-log.repository';
import { AUDIT_EVENT_CATALOG } from '../../admin/audit/audit.service';
import type { AuditQueryDto } from '../../admin/audit/dto/audit-query.dto';
import { AuditQueryService } from './audit-query.service';

const q = (over: Partial<AuditQueryDto> = {}): AuditQueryDto =>
  ({ limit: 50, ...over }) as AuditQueryDto;

const seedRow = (over: Partial<AuditRow> & { ts: Date; event: string }): AuditRow => ({
  id: uuidv7(),
  subject: null,
  requestId: null,
  bucket: null,
  objectKey: null,
  keyId: null,
  ip: null,
  detail: null,
  ...over,
});

/**
 * TEST-1103 — AuditQueryService (TASK-3332): filter translation, opaque cursor
 * encode/decode (+ malformed → 400), `nextCursor` derivation, and detail JSON
 * parsing.
 */
describe('AuditQueryService (TEST-1103)', () => {
  let orm: MikroORM;
  let svc: AuditQueryService;

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

  beforeEach(() => {
    svc = new AuditQueryService(repo());
  });

  afterEach(async () => {
    await orm.em.fork().nativeDelete(AuditLog, {});
  });

  afterAll(async () => {
    await orm?.close(true);
  });

  it('case 1: list returns items newest-first with a null nextCursor when no more', async () => {
    await repo().insertMany([
      seedRow({ ts: new Date('2026-02-01T00:00:00Z'), event: 'a', subject: 's1' }),
      seedRow({ ts: new Date('2026-02-02T00:00:00Z'), event: 'b', subject: 's2' }),
    ]);
    const page = await svc.list(q({ limit: 50 }));
    expect(page.items.map((i) => i.subject)).toEqual(['s2', 's1']);
    expect(page.nextCursor).toBeNull();
  });

  it('case 2: paging via nextCursor terminates with no overlap', async () => {
    const base = Date.parse('2026-04-01T00:00:00Z');
    const rows: AuditRow[] = [];
    for (let i = 0; i < 5; i++) {
      rows.push(seedRow({ ts: new Date(base + i * 1000), event: 'e', subject: `s${i}` }));
    }
    await repo().insertMany(rows);

    const p1 = await svc.list(q({ limit: 2 }));
    expect(p1.items.map((i) => i.subject)).toEqual(['s4', 's3']);
    expect(p1.nextCursor).not.toBeNull();

    const p2 = await svc.list(q({ limit: 2, cursor: p1.nextCursor! }));
    expect(p2.items.map((i) => i.subject)).toEqual(['s2', 's1']);

    const p3 = await svc.list(q({ limit: 2, cursor: p2.nextCursor! }));
    expect(p3.items.map((i) => i.subject)).toEqual(['s0']);
    expect(p3.nextCursor).toBeNull();
  });

  it('case 3: filters narrow the result set (exact event + ts range)', async () => {
    await repo().insertMany([
      seedRow({ ts: new Date('2026-05-01T00:00:00Z'), event: 'bucket.created', bucket: 'b1' }),
      seedRow({ ts: new Date('2026-05-05T00:00:00Z'), event: 'key.created', keyId: 'AKIA' }),
    ]);
    const page = await svc.list(q({ event: 'bucket.created' }));
    expect(page.items).toHaveLength(1);
    expect(page.items[0].bucket).toBe('b1');

    const ranged = await svc.list(
      q({ from: '2026-05-04T00:00:00Z', to: '2026-05-06T00:00:00Z' }),
    );
    expect(ranged.items.map((i) => i.event)).toEqual(['key.created']);
  });

  it('case 4: detail JSON is parsed back to an object', async () => {
    await repo().insertMany([
      seedRow({
        ts: new Date('2026-06-01T00:00:00Z'),
        event: 'object.presigned',
        detail: JSON.stringify({ expiresIn: 900 }),
      }),
    ]);
    const page = await svc.list(q());
    expect(page.items[0].detail).toEqual({ expiresIn: 900 });
  });

  it('case 5: a malformed cursor is a 400', async () => {
    await expect(svc.list(q({ cursor: 'not-a-valid-cursor!!' }))).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('case 6: catalog returns the static event-name list', () => {
    expect(svc.catalog().events).toEqual([...AUDIT_EVENT_CATALOG]);
  });
});
