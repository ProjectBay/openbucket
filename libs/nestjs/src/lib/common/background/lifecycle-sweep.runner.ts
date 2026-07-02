import { Injectable, Logger } from '@nestjs/common';
import { EntityManager } from '@mikro-orm/libsql';
import { InjectEntityManager } from '@mikro-orm/nestjs';

import { OPEN_BUCKET_ORM_CONTEXT } from '../../persistence/orm-context';
import { LifecycleService } from '../../domain/lifecycle/lifecycle.service';
import { ObjectService } from '../../domain/objects/object.service';
import { Clock } from '../clock/clock';
import { ScheduledTask } from './background.service';

const SIXTY_SEC = 60_000;
export const BATCH_SIZE = 500;
export const MAX_BATCHES_PER_TICK = 10; // 5000 objects/min upper bound

export interface ExpirationRule {
  readonly ruleId: string;
  readonly bucket: string;
  readonly prefix: string;
  /** Either `days` OR `date` — never both. */
  readonly days?: number;
  readonly date?: Date;
}

/**
 * Sweeps active lifecycle expiration rules on a 60s tick (§4.10). Each rule is
 * paged via a per-rule cursor in `lifecycle_state`, expired objects are moved to
 * trash one transaction per batch, and the runner yields to the event loop
 * between batches. After `MAX_BATCHES_PER_TICK` it pauses and resumes next tick
 * so a long sweep never holds the EntityManager open across a full scan. Reads
 * the Clock so conformance tests can fast-forward expiration.
 */
@Injectable()
export class LifecycleSweepRunner implements ScheduledTask {
  readonly name = 'lifecycle-sweep';
  readonly intervalMs = SIXTY_SEC;
  private readonly log = new Logger(LifecycleSweepRunner.name);

  constructor(
    @InjectEntityManager(OPEN_BUCKET_ORM_CONTEXT) private readonly em: EntityManager,
    private readonly lifecycle: LifecycleService,
    private readonly objects: ObjectService,
    private readonly clock: Clock,
  ) {}

  async run(): Promise<void> {
    const rules = await this.lifecycle.activeExpirationRules();
    const now = new Date(this.clock.nowMs());

    for (const rule of rules) {
      let batches = 0;
      let cursor = await this.lifecycle.loadCursor(rule.ruleId);

      while (batches < MAX_BATCHES_PER_TICK) {
        // Page through objects keyed by (bucket, key) starting after the cursor.
        const page = await this.objects.scanForLifecycle({
          bucket: rule.bucket,
          prefix: rule.prefix,
          afterKey: cursor,
          limit: BATCH_SIZE,
        });

        if (page.length === 0) {
          // Sweep complete for this rule; reset cursor for next tick.
          await this.lifecycle.saveCursor(rule.ruleId, null);
          break;
        }

        const expired = page.filter((obj) => this.isExpired(obj, rule, now));
        if (expired.length > 0) {
          // Move to trash in a single transaction per batch. The trash-purge tick
          // handles the actual blob removal after the grace period.
          await this.em.transactional(async (em) => {
            for (const obj of expired) {
              await this.objects.moveToTrash({ em, bucket: obj.bucket, key: obj.key });
            }
          });
          this.log.log(`Rule ${rule.ruleId} expired ${expired.length}/${page.length} in batch`);
        }

        cursor = page[page.length - 1].key;
        await this.lifecycle.saveCursor(rule.ruleId, cursor);
        batches++;

        // Yield to the event loop so request handlers aren't starved.
        await new Promise((r) => setImmediate(r));
      }

      if (batches === MAX_BATCHES_PER_TICK) {
        this.log.log(`Rule ${rule.ruleId} paused at cursor ${cursor}; resumes next tick`);
      }
    }
  }

  private isExpired(obj: { createdAt: Date }, rule: ExpirationRule, now: Date): boolean {
    if (rule.date) {
      return now.getTime() >= rule.date.getTime();
    }
    if (rule.days != null) {
      const ageMs = now.getTime() - obj.createdAt.getTime();
      return ageMs >= rule.days * 24 * 60 * 60 * 1000;
    }
    return false;
  }
}
