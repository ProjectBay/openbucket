import { Entity, Index, ManyToOne, PrimaryKey, Property } from '@mikro-orm/core';

import { Bucket } from './bucket.entity';
import { ObjectEntity } from './object.entity';

/**
 * Denormalised object-tag index (STORY-1101, TASK-3312). Object tags live in the
 * unindexed `objects.tagging` JSON column — the source of truth — which is
 * unsearchable at scale. This table holds one row per (object, tagKey, tagValue)
 * pair so cross-bucket search can filter by tag with an index-backed exact match
 * (`ix_object_tags_kv`) instead of a JSON scan. It is a DERIVED index: the write
 * path rebuilds an object's rows whenever its tag set changes, and a
 * background-tick runner backfills rows that predate the table, so a full rebuild
 * is always safe.
 *
 * `deleteRule: 'cascade'` on both FKs means deleting the object (or its bucket)
 * reaps its tag rows automatically — no orphans. `bucket` is denormalised so
 * search can order/keyset by bucket without a second hop through `objects`.
 */
@Entity({ tableName: 'object_tags' })
@Index({ name: 'ix_object_tags_kv', properties: ['tagKey', 'tagValue'] })
@Index({ name: 'ix_object_tags_object', properties: ['object'] })
export class ObjectTag {
  @PrimaryKey({ type: 'string' })
  id!: string; // uuid v7 — generated in the service/backfill layer

  @ManyToOne(() => ObjectEntity, { deleteRule: 'cascade', fieldName: 'object_id' })
  object!: ObjectEntity;

  @ManyToOne(() => Bucket, { deleteRule: 'cascade', fieldName: 'bucket_name' })
  bucket!: Bucket;

  @Property({ type: 'string', length: 128 })
  tagKey!: string;

  @Property({ type: 'string', length: 256 })
  tagValue!: string;
}
