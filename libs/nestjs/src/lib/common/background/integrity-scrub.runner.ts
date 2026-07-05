import { Injectable, Logger, Optional } from '@nestjs/common';
import { EntityManager } from '@mikro-orm/libsql';
import { InjectEntityManager } from '@mikro-orm/nestjs';

import { IntegrityStatus } from '../../persistence/entities/types';
import { ObjectEntity } from '../../persistence/entities/object.entity';
import { ScrubState, SCRUB_STATE_ID } from '../../persistence/entities/scrub-state.entity';
import { ObjectRepository } from '../../persistence/repositories/object.repository';
import { OPEN_BUCKET_ORM_CONTEXT } from '../../persistence/orm-context';
import { IntegrityVerifier } from '../../storage/integrity-verifier.service';
import { IntegrityRepairService } from '../../storage/integrity-repair.service';
import { AppConfigService } from '../config/app-config.service';
import { ScheduledTask } from './background.service';

/** Objects fetched per DB page (keyset range scan). */
export const INTEGRITY_SCRUB_BATCH_SIZE = 200;
/** Hard per-tick object cap — bounds detection work regardless of blob sizes. */
export const INTEGRITY_SCRUB_MAX_OBJECTS_PER_TICK = 1000;
/** Bounded length of the redacted per-object diagnostic (matches the column). */
const DETAIL_MAX = 255;

/**
 * Throttled, low-priority background scrubber (STORY-1204). On the §4.9 tick it
 * walks current/local objects via the keyset-paged {@link ObjectRepository.scanForScrub},
 * re-hashes each blob through the shared {@link IntegrityVerifier} (the SAME
 * whole-object plaintext SHA-256 as the F1 read gate), and persists a per-object
 * verdict (`ok`/`corrupt`). It follows the {@link TieringSweepRunner} /
 * `ReconcileRunner` throttling shape EXACTLY so it never starves request traffic:
 *
 *   - default-OFF (a fresh install performs zero disk reads / DB writes);
 *   - a hard per-tick object cap AND a per-tick byte budget — the tick stops and
 *     persists its cursor the moment either is hit, resuming next tick;
 *   - a `setImmediate` yield between batches so request handlers interleave;
 *   - the scheduler's own no-pile-up guard skips a slow tick rather than queueing.
 *
 * Per-object failures are isolated (caught, logged redacted) and the cursor ALWAYS
 * advances, so one poisoned key can't wedge the walk. A `corrupt` verdict is handed
 * to {@link IntegrityRepairService} (TASK-3643) when a replication target is
 * configured; repair is a no-op otherwise (the row stays `corrupt`).
 */
@Injectable()
export class IntegrityScrubRunner implements ScheduledTask {
  readonly name = 'integrity-scrub';
  private readonly log = new Logger(IntegrityScrubRunner.name);
  /** A getter (not a field initializer) so it reads the injected config after
   *  the constructor parameter property is bound. */
  get intervalMs(): number {
    return this.config.integrityScrubIntervalMs;
  }
  /** In-memory one-shot flag set by the admin "scrub now" trigger (TASK-3644),
   *  honored on the next tick even when the scheduled scrub is disabled. */
  private manualKick = false;

  constructor(
    @InjectEntityManager(OPEN_BUCKET_ORM_CONTEXT) private readonly em: EntityManager,
    private readonly objects: ObjectRepository,
    private readonly verifier: IntegrityVerifier,
    private readonly config: AppConfigService,
    // Optional (TASK-3643): repair a corrupt blob from the replication target.
    // @Optional so the detection loop works standalone and a deployment without
    // replication simply leaves a corrupt row `corrupt`.
    @Optional() private readonly repair?: IntegrityRepairService,
  ) {}

  /** Request a one-shot pass on the next tick (admin "scrub now"). */
  triggerManual(): void {
    this.manualKick = true;
  }

  async run(): Promise<void> {
    // Default-off gate (mirrors tiering-sweep): a fresh install performs zero
    // disk reads / DB writes. A manual admin kick forces a single pass even when
    // the scheduled scrub is disabled. Reading config only — no repo/blob access.
    const manual = this.manualKick;
    this.manualKick = false;
    if (!this.config.integrityScrubEnabled && !manual) return;

    const maxObjects = this.config.integrityScrubMaxObjectsPerTick;
    const maxBytes = BigInt(this.config.integrityScrubMaxBytesPerTick);

    const state = await this.loadState();
    let cursorBucket = state.cursorBucket ?? undefined;
    let cursorKey = state.cursorKey ?? undefined;
    let objectsThisTick = 0;
    let bytesThisTick = 0n;

    for (;;) {
      const page = await this.objects.scanForScrub({
        afterBucket: cursorBucket,
        afterKey: cursorKey,
        limit: INTEGRITY_SCRUB_BATCH_SIZE,
      });

      if (page.length === 0) {
        // Full pass complete: reset the cursor so the next tick starts over.
        state.cursorBucket = null;
        state.cursorKey = null;
        state.lastRunAt = new Date();
        await this.em.persistAndFlush(state);
        return;
      }

      for (const o of page) {
        // Budget check BEFORE hashing this object: stop the tick and persist the
        // resume point so the next tick continues from here (never re-hashes the
        // objects already done this tick).
        if (objectsThisTick >= maxObjects || bytesThisTick >= maxBytes) {
          state.cursorBucket = cursorBucket ?? null;
          state.cursorKey = cursorKey ?? null;
          state.lastRunAt = new Date();
          await this.em.persistAndFlush(state);
          this.log.log(
            `integrity-scrub: paused at ${cursorBucket ?? ''}/${cursorKey ?? ''} ` +
              `(objects=${objectsThisTick}, bytes=${bytesThisTick}); resumes next tick`,
          );
          return;
        }

        const bytes = await this.scrubOne(o, state);
        bytesThisTick += bytes;
        objectsThisTick += 1;
        // The cursor ALWAYS advances (even on ENOENT / a per-object error) so one
        // poisoned key can't wedge the walk.
        cursorBucket = o.bucket.name;
        cursorKey = o.key;
      }

      // Persist progress + resume cursor per batch (durable across a restart).
      state.cursorBucket = cursorBucket ?? null;
      state.cursorKey = cursorKey ?? null;
      state.lastRunAt = new Date();
      await this.em.persistAndFlush(state);

      // Yield so request handlers aren't starved (identical to tiering-sweep /
      // reconcile between-batch yield).
      await new Promise((r) => setImmediate(r));
    }
  }

  /**
   * Re-hash one object and persist its verdict. Returns the bytes hashed (0 on a
   * skip/error) so the caller can charge the per-tick byte budget. Fully isolated:
   * any failure is caught/logged and the walk continues.
   */
  private async scrubOne(o: ObjectEntity, state: ScrubState): Promise<bigint> {
    const bucket = o.bucket.name;
    try {
      const res = await this.verifier.verify(bucket, o.key, o.contentSha256!, {
        encryption: o.encryption ?? undefined,
      });

      if (res.ok) {
        await this.markVerdict(bucket, o.key, IntegrityStatus.Ok, null);
        state.scanned += 1;
        return res.bytesHashed;
      }

      // A mismatch could be a concurrent overwrite rather than bit-rot: re-read
      // the row's CURRENT contentSha256 and skip if it changed (avoid a false
      // positive on an object rewritten mid-walk).
      const current = await this.em.fork().findOne(
        ObjectEntity,
        { bucket: { name: bucket }, key: o.key, softDeleted: false },
        { fields: ['contentSha256'] },
      );
      if (!current || current.contentSha256 !== o.contentSha256) {
        this.log.debug(`integrity-scrub: ${bucket}/${o.key} changed mid-walk; leaving unchecked`);
        return res.bytesHashed;
      }

      // Genuine corruption at rest.
      this.log.error(`integrity-scrub: CORRUPT ${bucket}/${o.key}`);
      await this.markVerdict(
        bucket,
        o.key,
        IntegrityStatus.Corrupt,
        this.redact(`sha ${res.actualSha256} != ${o.contentSha256}`),
      );
      state.scanned += 1;
      state.corruptFound += 1;

      // Hand to repair (TASK-3643) when a target is configured; a repair failure
      // is isolated and leaves the row `corrupt`.
      if (this.repair) {
        try {
          const outcome = await this.repair.repair(o);
          if (outcome === 'repaired') state.repaired += 1;
        } catch (err) {
          this.log.warn(`integrity-scrub: repair of ${bucket}/${o.key} failed: ${this.redact(String((err as Error)?.message ?? err))}`);
        }
      }
      return res.bytesHashed;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        // Blob deleted mid-walk → leave `unchecked`, advance the cursor. NOT corrupt.
        this.log.debug(`integrity-scrub: blob ${bucket}/${o.key} vanished mid-walk; leaving unchecked`);
        return 0n;
      }
      this.log.warn(
        `integrity-scrub: failed to verify ${bucket}/${o.key}: ${this.redact(String((err as Error)?.message ?? err))}`,
      );
      return 0n;
    }
  }

  /** Persist a per-object verdict via nativeUpdate (no identity-map churn). */
  private async markVerdict(
    bucket: string,
    key: string,
    status: IntegrityStatus,
    detail: string | null,
  ): Promise<void> {
    await this.em.nativeUpdate(
      ObjectEntity,
      { bucket: { name: bucket }, key },
      { integrityStatus: status, integrityCheckedAt: new Date(), integrityDetail: detail },
    );
  }

  /** Load the single scrub_state row, creating it on first run. */
  private async loadState(): Promise<ScrubState> {
    let state = await this.em.findOne(ScrubState, { id: SCRUB_STATE_ID });
    if (!state) {
      state = this.em.create(ScrubState, { id: SCRUB_STATE_ID });
      await this.em.persistAndFlush(state);
    }
    return state;
  }

  /**
   * Bounded, defence-in-depth redaction for a diagnostic string written to
   * `integrity_detail` (never a credential — the digest strings carry none, but a
   * repair error could embed a URL). Strips any URL and caps at the column width.
   */
  private redact(msg: string): string {
    return msg.replace(/[a-z][a-z0-9+.-]*:\/\/[^\s]+/gi, '[remote]').slice(0, DETAIL_MAX);
  }
}
