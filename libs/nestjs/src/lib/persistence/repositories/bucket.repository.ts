import { EntityRepository } from '@mikro-orm/better-sqlite';

import { Bucket } from '../entities/bucket.entity';
import { VersioningState } from '../entities/types';

export class BucketRepository extends EntityRepository<Bucket> {
  /** Resolve a bucket by name with strict null. Used by every S3 handler. */
  async getByName(name: string): Promise<Bucket | null> {
    return this.findOne({ name });
  }

  /** Existence check — cheaper than fetching the full row. */
  async exists(name: string): Promise<boolean> {
    const row = await this.findOne({ name }, { fields: ['name'] });
    return row !== null;
  }

  /** True when the bucket emits version ids on writes. */
  async isVersioned(name: string): Promise<boolean> {
    const row = await this.findOne({ name }, { fields: ['versioning'] });
    return row?.versioning === VersioningState.Enabled;
  }

  /** True when the bucket has versioning either Enabled or Suspended. */
  async hasVersionHistory(name: string): Promise<boolean> {
    const row = await this.findOne({ name }, { fields: ['versioning'] });
    return row?.versioning !== undefined && row.versioning !== VersioningState.Disabled;
  }

  /** ListBuckets admin-API helper. */
  async listAll(): Promise<Bucket[]> {
    return this.findAll({ orderBy: { name: 'ASC' } });
  }
}
