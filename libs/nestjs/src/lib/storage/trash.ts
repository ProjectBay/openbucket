/**
 * Sibling JSON manifest written by `BlobStore.deleteBlob` next to each
 * trash entry (`<DATA_DIR>/trash/<entryId>.manifest.json`). See WHITEPAPER
 * §3.9.
 *
 * Discipline: the manifest is written **after** the blob has been renamed
 * into trash. If the manifest write fails, the file remains in trash without
 * a manifest — the EPIC-04 trash-purge tick treats unmanifested trash files
 * as "purge after grace period" (configurable default).
 *
 * There is no SQLite table for trash entries in v1; the filesystem is the
 * source of truth and the manifest doubles as the record.
 */
export interface TrashManifest {
  /** Matches the trash filename (without `.manifest.json` suffix). */
  entryId: string;
  /** Raw bucket name. */
  bucket: string;
  /** Raw S3 key (not percent-encoded). */
  key: string;
  /** Absolute path the blob was renamed from. */
  originalPath: string;
  /** ISO-8601 timestamp written at delete time. */
  deletedAt: string;
  /** ISO-8601, set by the lifecycle service when applicable. */
  scheduledPurgeAt?: string;
}
