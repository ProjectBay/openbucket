import { join, resolve, sep } from 'node:path';

import { encodeKey } from './key-codec';

/**
 * Thrown when a resolved on-disk path would escape its intended base directory
 * (CWE-22, path traversal). In practice unreachable: the key-codec
 * ({@link encodeKey}) percent-encodes `.`, `/` and control bytes so no `..`
 * traversal sequence can survive into a path segment. It exists so a future
 * regression in the codec — or a caller that reaches the filesystem without
 * going through it — fails closed with a clear error instead of silently
 * escaping DATA_DIR.
 */
export class PathEscapeError extends Error {
  override readonly name = 'PathEscapeError';
  constructor(readonly base: string, readonly target: string) {
    super(`resolved path escapes its base directory: ${target} not within ${base}`);
  }
}

/**
 * Defense-in-depth containment barrier (CWE-22). Normalises `target` with
 * `path.resolve` — collapsing any `.`/`..` segments — and asserts the result
 * stays within `base`, returning the resolved (and thus provably-contained)
 * path that all filesystem callers then use.
 *
 * Every path that folds in a user-influenced segment (S3 key, bucket name,
 * multipart uploadId) is funnelled through here at this single choke-point
 * before it can reach the fs layer, so a traversal sequence that somehow
 * bypassed the key-codec is rejected here rather than escaping DATA_DIR.
 *
 * This is a NO-OP for every real input: `base` is derived from an absolute
 * DATA_DIR and the variable segments are codec-encoded (no `.`/`/`), so
 * `resolve` is idempotent and the on-disk layout is unchanged.
 */
function contain(base: string, target: string): string {
  const resolvedBase = resolve(base);
  const resolved = resolve(target);
  if (resolved !== resolvedBase && !resolved.startsWith(resolvedBase + sep)) {
    throw new PathEscapeError(resolvedBase, resolved);
  }
  return resolved;
}

export class PathResolver {
  constructor(private readonly dataDir: string) {}

  blobsDir(): string {
    return join(this.dataDir, 'blobs');
  }
  bucketDir(bucket: string): string {
    return contain(this.blobsDir(), join(this.blobsDir(), bucket));
  }
  blobPath(bucket: string, key: string): string {
    return contain(this.blobsDir(), join(this.bucketDir(bucket), encodeKey(key)));
  }
  versionDir(bucket: string, key: string): string {
    return contain(this.blobsDir(), this.blobPath(bucket, key) + '.v');
  }
  versionPath(bucket: string, key: string, versionId: string): string {
    return contain(this.blobsDir(), join(this.versionDir(bucket, key), versionId));
  }
  multipartDir(uploadId: string): string {
    return contain(this.multipartRoot(), join(this.multipartRoot(), uploadId));
  }
  /** Root of the multipart staging tree (parent of each upload's dir). */
  multipartRoot(): string {
    return join(this.dataDir, 'multipart');
  }
  multipartPartPath(uploadId: string, partNumber: number): string {
    return contain(
      this.multipartRoot(),
      join(this.multipartDir(uploadId), `${partNumber}.part`),
    );
  }
  tmpDir(): string {
    return join(this.dataDir, 'tmp');
  }
  tmpPath(name: string): string {
    return join(this.tmpDir(), name);
  }
  trashDir(): string {
    return join(this.dataDir, 'trash');
  }
  /** Root of the content-addressed derivative (image-transform) cache. */
  derivativesDir(): string {
    return join(this.dataDir, 'derivatives');
  }
  /**
   * On-disk path for a cached derivative. Fans out by the first 2 hex chars of
   * the (hex-only) hash to avoid a single mega-directory. `hash` is always a
   * server-produced sha256 hex string and `ext` a fixed format extension, so
   * there is no user-controlled path segment here (no traversal surface).
   */
  derivativePath(hash: string, ext: string): string {
    return join(this.derivativesDir(), hash.slice(0, 2), `${hash}.${ext}`);
  }
}
