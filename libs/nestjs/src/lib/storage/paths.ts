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
}
