import { Injectable, Logger } from '@nestjs/common';
import { EntityManager } from '@mikro-orm/libsql';
import { InjectEntityManager } from '@mikro-orm/nestjs';
import { v7 as uuidv7 } from 'uuid';

import { OPEN_BUCKET_ORM_CONTEXT } from '../../persistence/orm-context';
import { ObjectEntity, ObjectTag } from '../../persistence/index';
import { ScheduledTask } from './background.service';

const FIVE_MIN = 5 * 60_000;
export const BATCH_SIZE = 500;
export const MAX_BATCHES_PER_TICK = 20; // 10k objects/tick upper bound

/**
 * Backfills the denormalised `object_tags` index (STORY-1101, TASK-3312) for
 * objects whose tags predate the table. Each tick pages objects that carry a
 * non-empty `objects.tagging` JSON but have no `object_tags` rows yet, inserts
 * the missing rows one batch (transaction) at a time, and yields to the event
 * loop between batches. After `MAX_BATCHES_PER_TICK` it pauses and resumes next
 * tick, so a long backfill never holds the EntityManager open across a full scan.
 *
 * Idempotent + self-terminating: `object_tags` is a derived index rebuilt on
 * every tagging write, so once every tagged object has its rows the selection is
 * empty and the tick is a no-op. Empty tag sets (`{}`) are excluded so they never
 * requeue forever. The batch/tick caps bound catch-up cost the same way the
 * lifecycle sweep does; S3 caps tags at 10/object so the row count is bounded.
 */
@Injectable()
export class TagIndexBackfillRunner implements ScheduledTask {
  readonly name = 'tag-index-backfill';
  readonly intervalMs = FIVE_MIN;
  private readonly log = new Logger(TagIndexBackfillRunner.name);

  constructor(
    @InjectEntityManager(OPEN_BUCKET_ORM_CONTEXT) private readonly em: EntityManager,
  ) {}

  async run(): Promise<void> {
    let cursor: string | null = null;
    let batches = 0;
    let inserted = 0;

    while (batches < MAX_BATCHES_PER_TICK) {
      const rows = await this.pageMissing(cursor);
      if (rows.length === 0) break;

      for (const obj of rows) {
        for (const [tagKey, tagValue] of Object.entries(obj.tagging ?? {})) {
          this.em.create(ObjectTag, {
            id: uuidv7(),
            object: obj,
            bucket: obj.bucket,
            tagKey,
            tagValue,
          });
          inserted++;
        }
      }
      await this.em.flush();

      cursor = rows[rows.length - 1].id;
      batches++;
      // Yield so request handlers aren't starved.
      await new Promise((r) => setImmediate(r));
    }

    if (inserted > 0) {
      this.log.log(`Backfilled ${inserted} object_tags row(s) across ${batches} batch(es)`);
    }
  }

  /**
   * Page (keyset over `id`) the objects that still need index rows: a non-empty
   * tagging JSON and no existing `object_tags` row. Bound parameters only — the
   * empty-set guard `'{}'` and the anti-join subquery carry no user input.
   */
  private pageMissing(cursor: string | null): Promise<ObjectEntity[]> {
    const qb = this.em
      .createQueryBuilder(ObjectEntity, 'o')
      .select('*')
      .where({ softDeleted: false })
      .andWhere(`o.tagging is not null and o.tagging != '{}'`)
      .andWhere(`o.id not in (select object_id from object_tags)`);
    if (cursor) qb.andWhere({ id: { $gt: cursor } });
    return qb.orderBy({ id: 'ASC' }).limit(BATCH_SIZE).getResult();
  }
}
