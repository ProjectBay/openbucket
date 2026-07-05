import { ConflictException, Injectable } from '@nestjs/common';
import { UniqueConstraintViolationException } from '@mikro-orm/core';
import { EntityManager } from '@mikro-orm/libsql';
import { InjectEntityManager } from '@mikro-orm/nestjs';
import { v7 as uuidv7 } from 'uuid';

import { Clock } from '../../common/clock/clock';
import {
  RECONCILE_ACTIVE_FLAG,
  ReconcileJob,
  type ReconcileScope,
} from '../../persistence/entities/reconcile-job.entity';
import { OPEN_BUCKET_ORM_CONTEXT } from '../../persistence/orm-context';

/** Bounded length of a persisted (redacted) job error message. */
const ERROR_MAX = 500;

export interface StartReconcileInput {
  scope: ReconcileScope;
  bucket?: string;
  subject: string;
}

/**
 * Owns reconcile-job lifecycle + single-flight enforcement (STORY-0902). `start`
 * inserts a `queued` row iff no job is currently active; the `active_flag` unique
 * index makes that atomic even under a race — a second concurrent `start` fails
 * the constraint and is rejected with `ConflictException` (409). This is the DoS
 * guard: at most ONE remote-listing scan exists at a time, independent of the
 * request throttler.
 *
 * State transitions funnel through {@link persistProgress} / {@link markTerminal}
 * so the `active_flag` invariant (`'active'` while queued/running, NULL when
 * terminal) is maintained in exactly one place. The `ReconcileRunner`
 * (background tick) drives the actual scan.
 */
@Injectable()
export class ReconcileService {
  constructor(
    @InjectEntityManager(OPEN_BUCKET_ORM_CONTEXT) private readonly em: EntityManager,
    private readonly clock: Clock,
  ) {}

  /**
   * Single-flight start. Rejects with `ConflictException` when a job is already
   * `queued`/`running`; otherwise inserts and returns a fresh `queued` job.
   */
  async start(input: StartReconcileInput): Promise<ReconcileJob> {
    try {
      return await this.em.transactional(async (tem) => {
        const active = await tem.findOne(ReconcileJob, { activeFlag: RECONCILE_ACTIVE_FLAG });
        if (active) throw new ConflictException('a reconcile job is already running');
        const job = tem.create(ReconcileJob, {
          id: uuidv7(),
          scope: input.scope,
          bucket: input.bucket,
          subject: input.subject,
          state: 'queued',
          localScanned: 0,
          remoteScanned: 0,
          missingRequeued: 0,
          activeFlag: RECONCILE_ACTIVE_FLAG,
          createdAt: this.clock.now(),
        });
        tem.persist(job);
        return job;
      });
    } catch (err) {
      // The unique index is the real backstop under a true race: the losing
      // INSERT surfaces here as a constraint violation → 409.
      if (err instanceof UniqueConstraintViolationException) {
        throw new ConflictException('a reconcile job is already running');
      }
      throw err;
    }
  }

  /** Fetch a job by id (null if unknown). */
  async get(jobId: string): Promise<ReconcileJob | null> {
    return this.em.findOne(ReconcileJob, { id: jobId });
  }

  /** The currently active (queued or running) job, if any. */
  async activeJob(): Promise<ReconcileJob | null> {
    return this.em.findOne(ReconcileJob, { activeFlag: RECONCILE_ACTIVE_FLAG });
  }

  /**
   * Claim the next job to work — the oldest active one (there is at most one) —
   * and mark it `running` (stamping `startedAt` on first claim). Returns null
   * when nothing is queued/running.
   */
  async claimNext(): Promise<ReconcileJob | null> {
    const job = await this.em.findOne(
      ReconcileJob,
      { activeFlag: RECONCILE_ACTIVE_FLAG },
      { orderBy: { createdAt: 'asc' } },
    );
    if (!job) return null;
    if (job.state === 'queued') {
      job.state = 'running';
      job.startedAt = this.clock.now();
      await this.em.persistAndFlush(job);
    }
    return job;
  }

  /** Persist mid-scan progress (counters + resume cursor) of a running job. */
  async persistProgress(job: ReconcileJob): Promise<void> {
    await this.em.persistAndFlush(job);
  }

  /**
   * Finalise a job: `completed` or `failed`. Clears `active_flag` (releasing the
   * single-flight slot), stamps `finishedAt`, and stores a bounded, redacted
   * `error` for the failed path. Callers pass an already-redacted message.
   */
  async markTerminal(
    job: ReconcileJob,
    state: 'completed' | 'failed',
    error?: string,
  ): Promise<void> {
    job.state = state;
    job.finishedAt = this.clock.now();
    job.activeFlag = null;
    if (state === 'failed') job.error = (error ?? 'reconcile failed').slice(0, ERROR_MAX);
    await this.em.persistAndFlush(job);
  }
}
