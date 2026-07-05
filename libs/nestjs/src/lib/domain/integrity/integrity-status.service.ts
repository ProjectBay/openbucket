import { Injectable } from '@nestjs/common';
import { raw } from '@mikro-orm/core';
import { EntityManager } from '@mikro-orm/libsql';
import { InjectEntityManager } from '@mikro-orm/nestjs';

import { AppConfigService } from '../../common/config/app-config.service';
import { ObjectEntity } from '../../persistence/entities/object.entity';
import { ScrubState, SCRUB_STATE_ID } from '../../persistence/entities/scrub-state.entity';
import { IntegrityStatus } from '../../persistence/entities/types';
import { ObjectRepository } from '../../persistence/repositories/object.repository';
import { OPEN_BUCKET_ORM_CONTEXT } from '../../persistence/orm-context';

/** Instance-wide integrity read model (the admin `status` endpoint). */
export interface IntegrityStatusView {
  /** Whether the scheduled scrub is enabled (false ⇒ counters may be stale/zero). */
  enabled: boolean;
  /** Lifetime objects re-hashed (from `scrub_state`). */
  scanned: number;
  /** Live objects currently marked `ok`. */
  ok: number;
  /** Live objects currently marked `corrupt`. */
  corrupt: number;
  /** Live objects not yet scrubbed. */
  unchecked: number;
  /** Lifetime blobs repaired from the replication target (from `scrub_state`). */
  repaired: number;
  /** ISO-8601 timestamp of the last scrub tick that did work; null if never run. */
  lastRunAt: string | null;
  /** Resume cursor `bucket/key`, or null when a fresh pass is about to start. */
  cursor: string | null;
}

/** One corrupt object row for the admin corrupt-list. */
export interface CorruptObjectView {
  bucket: string;
  key: string;
  /** ISO-8601 when the corruption was detected; null if unset. */
  checkedAt: string | null;
  /** The already-redacted 255-char diagnostic (never a URL/credential). */
  detail: string | null;
}

/** A page of the corrupt-object list. */
export interface CorruptListView {
  rows: CorruptObjectView[];
  total: number;
}

/**
 * Read model over the durable `scrub_state` counters + a live GROUP-BY of
 * `objects.integrity_status` (STORY-1204). PURE read — no blob access, no remote
 * calls. Every value is a count or an object identity; no remote endpoint or
 * credential is ever surfaced. Always returns a value even when the scrub is
 * disabled/never-run (`enabled:false`, zeroed counters) — matches
 * `getReplicationStatus`.
 */
@Injectable()
export class IntegrityStatusService {
  constructor(
    @InjectEntityManager(OPEN_BUCKET_ORM_CONTEXT) private readonly em: EntityManager,
    private readonly objects: ObjectRepository,
    private readonly config: AppConfigService,
  ) {}

  /** Full status summary: durable counters + live per-status counts. */
  async getStatus(): Promise<IntegrityStatusView> {
    const state = await this.em.findOne(ScrubState, { id: SCRUB_STATE_ID });
    const counts = await this.statusCounts();
    return {
      enabled: this.config.integrityScrubEnabled,
      scanned: state?.scanned ?? 0,
      ok: counts[IntegrityStatus.Ok] ?? 0,
      corrupt: counts[IntegrityStatus.Corrupt] ?? 0,
      unchecked: counts[IntegrityStatus.Unchecked] ?? 0,
      repaired: state?.repaired ?? 0,
      lastRunAt: state?.lastRunAt ? state.lastRunAt.toISOString() : null,
      cursor:
        state?.cursorBucket != null && state?.cursorKey != null
          ? `${state.cursorBucket}/${state.cursorKey}`
          : null,
    };
  }

  /** One page of corrupt objects (offset/limit bounded by the DTO). */
  async listCorrupt(input: { limit: number; offset: number }): Promise<CorruptListView> {
    const { rows, total } = await this.objects.listCorrupt(input);
    return {
      total,
      rows: rows.map((o) => ({
        bucket: o.bucket.name,
        key: o.key,
        checkedAt: o.integrityCheckedAt ? o.integrityCheckedAt.toISOString() : null,
        detail: o.integrityDetail ?? null,
      })),
    };
  }

  /**
   * Live count of current (non-soft-deleted) objects per integrity status — one
   * GROUP-BY, never materialises rows.
   */
  private async statusCounts(): Promise<Record<string, number>> {
    const rows = (await this.em
      .createQueryBuilder(ObjectEntity, 'o')
      .select([raw('o.integrity_status as status'), raw('count(*) as cnt')])
      .where({ softDeleted: false })
      .groupBy('o.integrity_status')
      .execute('all')) as { status: string; cnt: number | string }[];
    const out: Record<string, number> = {};
    for (const r of rows) out[String(r.status)] = Number(r.cnt);
    return out;
  }
}
