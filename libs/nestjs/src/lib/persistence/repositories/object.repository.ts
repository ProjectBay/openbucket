import { raw } from '@mikro-orm/core';
import { EntityRepository } from '@mikro-orm/libsql';

import { ObjectEntity } from '../entities/object.entity';
import { ObjectVersion } from '../entities/object-version.entity';
import { IntegrityStatus, ObjectLocation } from '../entities/types';

export interface ListPage {
  items: ObjectEntity[];
  isTruncated: boolean;
  nextMarker?: string;
  commonPrefixes: string[];
}

/** Cross-bucket search match mode (§STORY-1101, TASK-3310). */
export type SearchMode = 'prefix' | 'contains';

/** Criteria for {@link ObjectRepository.searchAcrossBuckets} (serializable). */
export interface ObjectSearchCriteria {
  /** Already length/trim-validated by the DTO. */
  term: string;
  mode: SearchMode;
  /** Optional single-bucket narrowing. */
  bucket?: string;
  /** Exact-match tag filter; both must be set together (index-backed, TASK-3312). */
  tagKey?: string;
  tagValue?: string;
  /** Keyset cursor — exclusive lower bound in `(bucket, key)` order. */
  cursor?: { bucket: string; key: string };
  /** Clamped 1..100 by the DTO. */
  limit: number;
}

/** One page of cross-bucket search results. */
export interface ObjectSearchPage {
  /** length <= limit */
  rows: ObjectEntity[];
  /** there was a limit+1'th matching row */
  truncated: boolean;
}

/**
 * The escape character bound into `LIKE … ESCAPE` for substring search. A
 * backslash so `%`, `_`, and `\` in user input match literally rather than as
 * SQL wildcards (CWE-150 / TASK-2162 posture, extended from prefix to substring).
 */
export const LIKE_ESCAPE_CHAR = '\\';

/**
 * Escape a raw user term for safe use inside a `LIKE` pattern: prefix each `\`,
 * `%`, and `_` with {@link LIKE_ESCAPE_CHAR} so they match literally. Order
 * matters — the escape char itself is escaped FIRST (the single regex pass over
 * the alternation `[\\%_]` achieves this in one replace).
 */
export function escapeLikePattern(s: string): string {
  return s.replace(/[\\%_]/g, (ch) => LIKE_ESCAPE_CHAR + ch);
}

export class ObjectRepository extends EntityRepository<ObjectEntity> {
  /**
   * Resolve the current pointer row for (bucket, key). Returns null if the
   * key has never existed in this bucket or if the pointer is soft-deleted.
   */
  async findCurrentVersion(bucket: string, key: string): Promise<ObjectEntity | null> {
    return this.findOne(
      { bucket: { name: bucket }, key, softDeleted: false },
      { populate: ['bucket'] },
    );
  }

  /**
   * Paginated, prefix-scoped list. Implements S3 ListObjectsV2 semantics:
   *   - prefix:  string filter on key (range scan, not LIKE)
   *   - marker:  exclusive lower bound (StartAfter / ContinuationToken)
   *   - limit:   MaxKeys; the implementation requests limit + 1 to detect truncation
   *
   * Keys are stored raw (UTF-8). SQLite compares text under BINARY collation by
   * default, which matches S3's byte-wise lex order.
   */
  async listByPrefix(
    bucket: string,
    prefix: string,
    marker: string | undefined,
    limit: number,
  ): Promise<{ rows: ObjectEntity[]; truncated: boolean }> {
    const qb = this.createQueryBuilder('o')
      .select('*')
      .where({ bucket: { name: bucket }, softDeleted: false });

    if (prefix.length > 0) {
      // Range scan: prefix <= key < nextStringBound(prefix). Indexed.
      const upper = nextStringBound(prefix);
      qb.andWhere({ key: { $gte: prefix, $lt: upper } });
    }

    if (marker !== undefined && marker.length > 0) {
      qb.andWhere({ key: { $gt: marker } });
    }

    qb.orderBy({ key: 'ASC' }).limit(limit + 1);

    const all = await qb.getResult();
    return {
      rows: all.slice(0, limit),
      truncated: all.length > limit,
    };
  }

  /**
   * Cross-bucket object search with keyset pagination over `(bucket, key)`
   * (STORY-1101). Scans the current, non-soft-deleted pointer rows across ALL
   * buckets (or one named `bucket`), in two match modes:
   *
   *   - `prefix`   — an indexed byte-wise range scan (`$gte`/`$lt`), NOT `LIKE`,
   *                  so it rides `ix_objects_bucket_key` when a `bucket` is fixed.
   *   - `contains` — a substring match via a parameterised `LIKE … ESCAPE` with
   *                  the term run through {@link escapeLikePattern}, so `%`/`_`/`\`
   *                  in user input match literally (CWE-150). Unindexed by nature;
   *                  the DTO's min-length guard + the `limit + 1` cap bound it.
   *
   * An optional exact-match `tagKey`/`tagValue` filter joins the indexed
   * `object_tags` table (TASK-3312). Pagination is keyset (never OFFSET — a
   * deep-pagination DoS): each page starts strictly after `cursor` in
   * `(bucket, key)` order, so page N is as cheap as page 1. Requests `limit + 1`
   * to detect truncation the same way {@link listByPrefix} does.
   *
   * Keys are stored raw (UTF-8); SQLite's BINARY collation matches S3's byte-wise
   * lex order, so the cursor comparison and `nextStringBound` bound are S3-correct.
   */
  async searchAcrossBuckets(c: ObjectSearchCriteria): Promise<ObjectSearchPage> {
    const qb = this.createQueryBuilder('o').select('*').where({ softDeleted: false });

    if (c.mode === 'prefix') {
      // Indexed range scan: term <= key < nextStringBound(term). No LIKE.
      if (c.term.length > 0) {
        qb.andWhere({ key: { $gte: c.term, $lt: nextStringBound(c.term) } });
      }
    } else {
      // Substring: bind the escaped term into a parameterised LIKE … ESCAPE. The
      // term is NEVER interpolated into SQL — always a bound parameter.
      qb.andWhere('o.key LIKE ? ESCAPE ?', [`%${escapeLikePattern(c.term)}%`, LIKE_ESCAPE_CHAR]);
    }

    if (c.bucket !== undefined) {
      qb.andWhere({ bucket: { name: c.bucket } });
    }

    // Exact-match, index-backed tag filter (ix_object_tags_kv) — NOT a LIKE, so
    // no wildcard concern. Both fields are guaranteed present together by the DTO.
    if (c.tagKey !== undefined && c.tagValue !== undefined) {
      qb.join('o.tags', 't').andWhere({ 't.tagKey': c.tagKey, 't.tagValue': c.tagValue });
    }

    if (c.cursor) {
      // Row strictly after (cursor.bucket, cursor.key) in (bucket, key) order.
      qb.andWhere({
        $or: [
          { bucket: { name: { $gt: c.cursor.bucket } } },
          {
            $and: [
              { bucket: { name: c.cursor.bucket } },
              { key: { $gt: c.cursor.key } },
            ],
          },
        ],
      });
    }

    qb.orderBy({ bucket: 'ASC', key: 'ASC' }).limit(c.limit + 1);

    const all = await qb.getResult();
    return { rows: all.slice(0, c.limit), truncated: all.length > c.limit };
  }

  /** ListObjectVersions support — flat scan of the versions table by prefix. */
  async listVersionsByPrefix(
    bucket: string,
    prefix: string,
    keyMarker: string | undefined,
    versionMarker: string | undefined,
    limit: number,
  ): Promise<ObjectVersion[]> {
    const em = this.getEntityManager();
    const qb = em
      .createQueryBuilder(ObjectVersion, 'v')
      .select('*')
      .where({ bucket: { name: bucket } });

    if (prefix.length > 0) {
      const upper = nextStringBound(prefix);
      qb.andWhere({ key: { $gte: prefix, $lt: upper } });
    }
    if (keyMarker !== undefined) {
      if (versionMarker !== undefined) {
        qb.andWhere({
          $or: [
            { key: { $gt: keyMarker } },
            { $and: [{ key: keyMarker }, { versionId: { $gt: versionMarker } }] },
          ],
        });
      } else {
        qb.andWhere({ key: { $gt: keyMarker } });
      }
    }

    qb.orderBy({ key: 'ASC', createdAt: 'DESC' }).limit(limit + 1);
    return qb.getResult();
  }

  /**
   * Per-bucket aggregate of live (non-soft-deleted) objects in ONE grouped query
   * (STORY-1102, TASK-3320) — the usage-rollup runner uses this instead of an
   * N+1 loop of {@link ObjectService.statsFor}. Buckets with zero live objects
   * do not appear in the result (the runner seeds those as `0/0` from the bucket
   * list). Sizes read back through `Number(...)` (bigint affinity in SQLite).
   */
  async aggregateByBucket(): Promise<
    { bucket: string; objectCount: number; sizeBytes: number }[]
  > {
    const rows = (await this.getEntityManager()
      .createQueryBuilder(ObjectEntity, 'o')
      .select([
        raw('o.bucket_name as bucket'),
        raw('count(*) as objectCount'),
        raw('coalesce(sum(o.size), 0) as sizeBytes'),
      ])
      .where({ softDeleted: false })
      .groupBy('o.bucket_name')
      .execute('all')) as { bucket: string; objectCount: number; sizeBytes: number }[];
    return rows.map((r) => ({
      bucket: String(r.bucket),
      objectCount: Number(r.objectCount),
      sizeBytes: Number(r.sizeBytes),
    }));
  }

  /**
   * One page of objects for the background integrity scrubber (STORY-1204),
   * paged by a keyset cursor over `(bucket, key)` — the SAME indexed range scan
   * the tiering/reconcile runners use, never a `LIKE` or `OFFSET`. Only rows the
   * scrubber can actually re-hash locally are returned:
   *   - `softDeleted = false`      — the current, live pointer row;
   *   - `location = 'local'`       — tiered objects live on the remote and are
   *                                  re-verified on rehydrate, so they're excluded;
   *   - `contentSha256 IS NOT NULL`— pre-F1 writes carry no stored digest and are
   *                                  skipped (never marked corrupt).
   * `populate: ['bucket']` so the runner can read `o.bucket.name` + `o.encryption`
   * without an extra query per object. Requests exactly `limit` rows in
   * `(bucket, key)` order; the caller advances the cursor from the last row.
   */
  async scanForScrub(input: {
    afterBucket?: string;
    afterKey?: string;
    limit: number;
  }): Promise<ObjectEntity[]> {
    const where: Record<string, unknown> = {
      softDeleted: false,
      location: ObjectLocation.Local,
      contentSha256: { $ne: null },
    };

    if (input.afterBucket !== undefined && input.afterKey !== undefined) {
      // Row strictly after (afterBucket, afterKey) in (bucket, key) order.
      where.$or = [
        { bucket: { name: { $gt: input.afterBucket } } },
        {
          $and: [
            { bucket: { name: input.afterBucket } },
            { key: { $gt: input.afterKey } },
          ],
        },
      ];
    }

    return this.find(where, {
      populate: ['bucket'],
      orderBy: { bucket: { name: 'ASC' }, key: 'ASC' },
      limit: input.limit,
    });
  }

  /**
   * The paged corrupt-object list for the admin integrity surface (STORY-1204).
   * `WHERE integrity_status = 'corrupt'` rides `ix_objects_integrity`. Bounded by
   * `limit`/`offset` (the DTO caps `limit`) so the admin route can't be turned
   * into an unbounded scan. Returns the rows plus the total corrupt count so the
   * UI can paginate.
   */
  async listCorrupt(input: {
    limit: number;
    offset: number;
  }): Promise<{ rows: ObjectEntity[]; total: number }> {
    const where = { integrityStatus: IntegrityStatus.Corrupt };
    const [rows, total] = await this.findAndCount(where, {
      populate: ['bucket'],
      orderBy: { integrityCheckedAt: 'DESC', bucket: 'ASC', key: 'ASC' },
      limit: input.limit,
      offset: input.offset,
    });
    return { rows, total };
  }

  /** Returns the most recent version row for (bucket, key). */
  async findLatestVersion(bucket: string, key: string): Promise<ObjectVersion | null> {
    const em = this.getEntityManager();
    return em.findOne(
      ObjectVersion,
      { bucket: { name: bucket }, key },
      { orderBy: { createdAt: 'DESC' } },
    );
  }
}

/**
 * Smallest string strictly greater than every string with `prefix` as a prefix.
 * Walks back from the end incrementing the first non-`0xFF` byte. If the entire
 * prefix is `0xFF` runs, appends the U+FFFF sentinel — guaranteed larger than
 * any string with that prefix under BINARY collation.
 */
export function nextStringBound(prefix: string): string {
  const bytes = Buffer.from(prefix, 'utf8');
  for (let i = bytes.length - 1; i >= 0; i--) {
    if (bytes[i] < 0xff) {
      const out = Buffer.from(bytes.subarray(0, i + 1));
      out[i] = out[i] + 1;
      return out.toString('binary'); // pass-through byte string
    }
  }
  return prefix + '￿';
}
