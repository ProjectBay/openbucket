/**
 * The object-event contract (STORY-0801). A single flat, JSON-serializable shape
 * is emitted at every write/delete choke point and is the exact body a webhook
 * signs + sends (`JSON.stringify(event)`), so keeping it flat avoids any
 * re-serialization drift between the persisted outbox row and the signed bytes.
 */

/** The three event names. Fixed constants — never derived from a user-controlled
 * string, so the `EventEmitter2` wildcard/namespace surface is unreachable from
 * object keys. */
export const OBJECT_EVENTS = {
  created: 'object.created',
  deleted: 'object.deleted',
  multipartCompleted: 'multipart.completed',
} as const;

export type ObjectEventType = (typeof OBJECT_EVENTS)[keyof typeof OBJECT_EVENTS];

/** The set of valid event names, for cheap membership checks (config filter). */
export const OBJECT_EVENT_TYPES: ReadonlySet<string> = new Set(Object.values(OBJECT_EVENTS));

/**
 * A single object-store notification. All fields are already-authorized,
 * already-bounded values taken from the committed row — no request headers or
 * credentials are ever included.
 */
export interface ObjectEvent {
  type: ObjectEventType;
  bucket: string;
  key: string;
  /** Bytes; `0` for a delete / delete-marker. */
  size: number;
  /** Object ETag; `''` for a delete-marker. */
  etag: string;
  /** Present only on versioning-enabled buckets. */
  versionId?: string;
  /** ISO-8601 (`Date.toISOString()`). */
  eventTime: string;
}
