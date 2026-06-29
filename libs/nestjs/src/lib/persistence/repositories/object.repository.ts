import { EntityRepository } from '@mikro-orm/better-sqlite';

import { ObjectEntity } from '../entities/object.entity';
import { ObjectVersion } from '../entities/object-version.entity';

export interface ListPage {
  items: ObjectEntity[];
  isTruncated: boolean;
  nextMarker?: string;
  commonPrefixes: string[];
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
