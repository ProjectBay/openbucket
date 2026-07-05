import { Entity, PrimaryKey, Property } from '@mikro-orm/core';

/** The single well-known row id for the integrity scrubber's durable state. */
export const SCRUB_STATE_ID = 'default';

/**
 * Durable state of the background integrity scrubber (STORY-1204): a single
 * well-known row (`id = 'default'`) holding the resume cursor and lifetime
 * counters so the admin status endpoint reads stable numbers across restarts.
 *
 * `cursorBucket`/`cursorKey` are the keyset resume point of the paged
 * `scanForScrub` walk; both null means "start a fresh full pass". The counters
 * are monotonic lifetime totals (never reset by a pass boundary). The admin
 * "scrub now" trigger is an in-memory one-shot flag on the runner (honored on the
 * next tick), so no column is needed here.
 */
@Entity({ tableName: 'scrub_state' })
export class ScrubState {
  @PrimaryKey({ type: 'string', length: 32 })
  id: string = SCRUB_STATE_ID;

  /** Keyset resume cursor — bucket component. Null ⇒ start of a fresh pass. */
  @Property({ type: 'string', length: 63, nullable: true })
  cursorBucket?: string | null;

  /** Keyset resume cursor — key component. Null ⇒ start of a fresh pass. */
  @Property({ type: 'text', nullable: true })
  cursorKey?: string | null;

  /** When the last tick ran (stamped every tick that does work). */
  @Property({ type: 'datetime', nullable: true })
  lastRunAt?: Date;

  /** Lifetime count of objects re-hashed. */
  @Property({ type: 'integer', default: 0 })
  scanned = 0;

  /** Lifetime count of corrupt verdicts recorded. */
  @Property({ type: 'integer', default: 0 })
  corruptFound = 0;

  /** Lifetime count of blobs repaired from the replication target. */
  @Property({ type: 'integer', default: 0 })
  repaired = 0;
}
