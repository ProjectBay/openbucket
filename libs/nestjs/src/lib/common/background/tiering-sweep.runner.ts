import { Injectable, Logger } from '@nestjs/common';
import { EntityManager } from '@mikro-orm/libsql';
import { InjectEntityManager } from '@mikro-orm/nestjs';

import { AppConfigService } from '../config/app-config.service';
import { LifecycleService } from '../../domain/lifecycle/lifecycle.service';
import { ObjectService } from '../../domain/objects/object.service';
import { TieringService } from '../../domain/tiering/tiering.service';
import { ObjectLocation, StorageClass } from '../../persistence/index';
import { OPEN_BUCKET_ORM_CONTEXT } from '../../persistence/orm-context';
import { Clock } from '../clock/clock';
import { ScheduledTask } from './background.service';

const SIXTY_SEC = 60_000;
const DAY_MS = 24 * 60 * 60 * 1000;
export const TIERING_BATCH_SIZE = 500;
export const TIERING_MAX_BATCHES_PER_TICK = 10; // 5000 objects/min upper bound

/** A day-based lifecycle *transition* rule flattened for the tiering sweep. */
export interface TransitionRule {
  readonly ruleId: string;
  readonly bucket: string;
  readonly prefix: string;
  /** Age (days, since last access) after which a local object is offloaded. */
  readonly days: number;
  /** Target storage class recorded on the tiered stub. */
  readonly storageClass: StorageClass;
}

/**
 * Offloads cold objects to the STORY-0900 remote on a 60s tick (STORY-0901).
 * Mirrors {@link LifecycleSweepRunner} exactly — active transition rules are each
 * paged via a per-rule cursor in `tiering_state`, and the runner yields to the
 * event loop between batches and pauses after {@link TIERING_MAX_BATCHES_PER_TICK}.
 *
 * A no-op unless `OPENBUCKET_TIER_ENABLED` is set AND a remote target is
 * configured — so a fresh single-node install performs no remote or FS mutation.
 * Per-object failures are isolated (caught, logged, the object left LOCAL) and the
 * cursor always advances, so one poisoned key can't stall the rule (matches the
 * lifecycle runner's resilience). Object-lock retention/legal-hold is unaffected —
 * tiering only moves the bytes; the row + lock stay, so GET still enforces the lock.
 */
@Injectable()
export class TieringSweepRunner implements ScheduledTask {
  readonly name = 'tiering-sweep';
  readonly intervalMs = SIXTY_SEC;
  private readonly log = new Logger(TieringSweepRunner.name);

  constructor(
    @InjectEntityManager(OPEN_BUCKET_ORM_CONTEXT) private readonly em: EntityManager,
    private readonly lifecycle: LifecycleService,
    private readonly objects: ObjectService,
    private readonly tiering: TieringService,
    private readonly config: AppConfigService,
    private readonly clock: Clock,
  ) {}

  async run(): Promise<void> {
    // Gated on BOTH the master switch and a configured remote — no surprise data
    // movement (matches the story AC: default-off performs zero mutation).
    if (!this.config.tierEnabled || !this.tiering.remoteEnabled) return;

    const rules = await this.lifecycle.activeTransitionRules();
    const nowMs = this.clock.nowMs();

    for (const rule of rules) {
      let batches = 0;
      let cursor = await this.lifecycle.loadTieringCursor(rule.ruleId);

      while (batches < TIERING_MAX_BATCHES_PER_TICK) {
        const page = await this.objects.scanForTiering({
          bucket: rule.bucket,
          prefix: rule.prefix,
          afterKey: cursor,
          limit: TIERING_BATCH_SIZE,
        });

        if (page.length === 0) {
          await this.lifecycle.saveTieringCursor(rule.ruleId, null);
          break;
        }

        const cold = page.filter((o) => this.isCold(o, rule, nowMs));
        let tiered = 0;
        for (const obj of cold) {
          try {
            const outcome = await this.tiering.tierToRemote({
              em: this.em,
              bucket: obj.bucket,
              key: obj.key,
              storageClass: rule.storageClass,
            });
            if (outcome === 'tiered') tiered++;
          } catch (err) {
            // Per-object isolation: a remote outage / mismatch leaves the object
            // LOCAL and must not stall the sweep. Log + continue; the cursor still
            // advances so a poisoned key can't wedge the rule.
            this.log.warn(
              `tiering-sweep: failed to tier ${obj.bucket}/${obj.key}: ${(err as Error)?.message ?? err}`,
            );
          }
        }
        if (tiered > 0) {
          this.log.log(`Rule ${rule.ruleId} tiered ${tiered}/${page.length} in batch`);
        }

        cursor = page[page.length - 1].key;
        await this.lifecycle.saveTieringCursor(rule.ruleId, cursor);
        batches++;

        // Yield so request handlers aren't starved.
        await new Promise((r) => setImmediate(r));
      }

      if (batches === TIERING_MAX_BATCHES_PER_TICK) {
        this.log.log(`Rule ${rule.ruleId} paused at cursor ${cursor}; resumes next tick`);
      }
    }
  }

  /**
   * Cold predicate: a current, LOCAL object whose last access
   * (`lastAccessedAt ?? modifiedAt`) is older than the rule window. Read/HEAD
   * stamps `lastAccessedAt` (TASK-2712), so this means "not read recently".
   */
  private isCold(
    obj: { location: ObjectLocation; lastAccessedAt?: Date; modifiedAt: Date },
    rule: TransitionRule,
    nowMs: number,
  ): boolean {
    if (obj.location !== ObjectLocation.Local) return false;
    const lastAccess = (obj.lastAccessedAt ?? obj.modifiedAt).getTime();
    return nowMs - lastAccess >= rule.days * DAY_MS;
  }
}
