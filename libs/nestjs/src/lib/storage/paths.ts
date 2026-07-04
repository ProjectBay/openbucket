import { join } from 'node:path';

import { encodeKey } from './key-codec';

export class PathResolver {
  constructor(private readonly dataDir: string) {}

  blobsDir(): string {
    return join(this.dataDir, 'blobs');
  }
  bucketDir(bucket: string): string {
    return join(this.blobsDir(), bucket);
  }
  blobPath(bucket: string, key: string): string {
    return join(this.bucketDir(bucket), encodeKey(key));
  }
  versionDir(bucket: string, key: string): string {
    return this.blobPath(bucket, key) + '.v';
  }
  versionPath(bucket: string, key: string, versionId: string): string {
    return join(this.versionDir(bucket, key), versionId);
  }
  multipartDir(uploadId: string): string {
    return join(this.dataDir, 'multipart', uploadId);
  }
  /** Root of the multipart staging tree (parent of each upload's dir). */
  multipartRoot(): string {
    return join(this.dataDir, 'multipart');
  }
  multipartPartPath(uploadId: string, partNumber: number): string {
    return join(this.multipartDir(uploadId), `${partNumber}.part`);
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
