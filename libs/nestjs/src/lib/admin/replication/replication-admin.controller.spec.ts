import { ConflictException, NotFoundException } from '@nestjs/common';
import type { Request } from 'express';

import { ReplicationAdminController } from './replication-admin.controller';
import type { ReconcileService } from '../../domain/replication/reconcile.service';
import type { ReplicationStatusService } from '../../domain/replication/replication-status.service';
import type { ReconcileJob } from '../../persistence/entities/reconcile-job.entity';
import type { AuditService } from '../audit/audit.service';

/**
 * TEST-0902 — ReplicationAdminController: read-model mapping, reconcile accept +
 * audit, the 409 single-flight passthrough, and job polling.
 */
function build() {
  const status = { getStatus: jest.fn(), getBucketStatus: jest.fn() };
  const reconcile = { start: jest.fn(), get: jest.fn(), activeJob: jest.fn() };
  const audit = { emit: jest.fn() };
  const ctrl = new ReplicationAdminController(
    status as unknown as ReplicationStatusService,
    reconcile as unknown as ReconcileService,
    audit as unknown as AuditService,
  );
  return { status, reconcile, audit, ctrl };
}

function req(): Request {
  return { user: { username: 'admin', sub: 'u1' }, openbucket: { requestId: 'req-1' } } as unknown as Request;
}

function job(over: Partial<ReconcileJob> = {}): ReconcileJob {
  return {
    id: 'job-1',
    scope: 'instance',
    state: 'queued',
    localScanned: 0,
    remoteScanned: 0,
    missingRequeued: 0,
    createdAt: new Date(),
    ...over,
  } as ReconcileJob;
}

describe('ReplicationAdminController (TEST-0902)', () => {
  it('case: getStatus returns the read model verbatim', async () => {
    const { status, ctrl } = build();
    const model = {
      enabled: true,
      pendingCount: 3,
      inflightCount: 1,
      failedCount: 0,
      oldestPendingAgeMs: 5000,
      lastError: null,
      perBucket: [],
    };
    status.getStatus.mockResolvedValue(model);
    expect(await ctrl.getStatus()).toBe(model);
  });

  it('case: startReconcile (instance) accepts, maps the job, and audits', async () => {
    const { reconcile, audit, ctrl } = build();
    reconcile.start.mockResolvedValue(job({ id: 'j1', scope: 'instance', state: 'queued' }));

    const dto = await ctrl.startReconcile({}, req());

    expect(reconcile.start).toHaveBeenCalledWith({ scope: 'instance', bucket: undefined, subject: 'admin' });
    expect(dto).toMatchObject({ jobId: 'j1', scope: 'instance', state: 'queued', startedAt: null });
    expect(audit.emit).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'replication.reconcile.started', subject: 'admin', jobId: 'j1' }),
    );
    // No remote target details in the audit event.
    const event = audit.emit.mock.calls[0][0];
    expect(JSON.stringify(event)).not.toMatch(/endpoint|secret|accessKey/i);
  });

  it('case: startReconcile (bucket) scopes to the bucket and audits the bucket', async () => {
    const { reconcile, audit, ctrl } = build();
    reconcile.start.mockResolvedValue(job({ id: 'j2', scope: 'bucket', bucket: 'photos', state: 'queued' }));

    const dto = await ctrl.startReconcile({ bucket: 'photos' }, req());

    expect(reconcile.start).toHaveBeenCalledWith({ scope: 'bucket', bucket: 'photos', subject: 'admin' });
    expect(dto.scope).toBe('bucket');
    expect(audit.emit).toHaveBeenCalledWith(expect.objectContaining({ bucket: 'photos' }));
  });

  it('case: a second reconcile while one is active surfaces the 409 from the service', async () => {
    const { reconcile, ctrl } = build();
    reconcile.start.mockRejectedValue(new ConflictException('already running'));
    await expect(ctrl.startReconcile({}, req())).rejects.toBeInstanceOf(ConflictException);
  });

  it('case: getJob maps a running job with timestamps', async () => {
    const { reconcile, ctrl } = build();
    reconcile.get.mockResolvedValue(
      job({
        id: 'j3',
        state: 'running',
        localScanned: 10,
        remoteScanned: 7,
        missingRequeued: 3,
        startedAt: new Date('2026-07-05T12:00:00.000Z'),
      }),
    );
    const dto = await ctrl.getJob('j3');
    expect(dto).toMatchObject({
      jobId: 'j3',
      state: 'running',
      localScanned: 10,
      missingRequeued: 3,
      startedAt: '2026-07-05T12:00:00.000Z',
    });
  });

  it('case: getJob throws 404 for an unknown job', async () => {
    const { reconcile, ctrl } = build();
    reconcile.get.mockResolvedValue(null);
    await expect(ctrl.getJob('nope')).rejects.toBeInstanceOf(NotFoundException);
  });
});
