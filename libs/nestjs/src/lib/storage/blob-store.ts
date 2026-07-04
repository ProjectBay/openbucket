import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream, promises as fs, ReadStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { dirname, join } from 'node:path';

import { Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { PathResolver } from './paths';
import type { TrashManifest } from './trash';
import type { FreeSpaceService } from './free-space.service';

/**
 * Thrown by {@link BlobStore.putBlob} when the streamed input exceeds the
 * caller-supplied `maxSize` cap (TASK-2143, CWE-409/400). The pipeline is aborted
 * and the staging temp file unlinked before the bytes can fill the disk. Callers
 * (e.g. the restore path) map this to a 400.
 */
export class MaxBlobSizeExceededError extends Error {
  constructor(public readonly maxSize: number) {
    super(`blob exceeds the maximum allowed size of ${maxSize} bytes`);
    this.name = 'MaxBlobSizeExceededError';
  }
}

export interface PutResult {
  /** Bytes written, post-flush. */
  size: bigint;
  /** Hex MD5 — the canonical S3 ETag for single-part objects. */
  etag: string;
  /** Hex SHA-256 — for x-amz-content-sha256 verification. */
  sha256: string;
  /** Final on-disk path after rename. */
  finalPath: string;
}

export interface RangeSpec {
  /** Inclusive byte offset. */
  start: number;
  /** Inclusive byte offset, or undefined to read through EOF. */
  end?: number;
}

export interface HeadResult {
  size: bigint;
  mtime: Date;
}

export interface BlobRef {
  path: string;
  size: bigint;
}

@Injectable()
export class BlobStore {
  private readonly log = new Logger(BlobStore.name);
  readonly paths: PathResolver;

  constructor(
    config: ConfigService,
    // Optional so unit tests can `new BlobStore(stubConfig)` without the guard;
    // production DI (StorageModule) always supplies it (TASK-2140).
    @Optional() private readonly freeSpace?: FreeSpaceService,
  ) {
    this.paths = new PathResolver(config.getOrThrow<string>('DATA_DIR'));
  }

  /**
   * Shutdown flush seam (§4.12 step 4). Today every write opens and closes its
   * own file handle inside {@link putBlob}/{@link putPart} (two-phase
   * tmp→fsync→rename), so there are no pooled descriptors to flush and this is
   * a no-op. It exists so {@link ShutdownService} can `await blobs.close()`
   * before the EM/SQLite close, and so a future pooled-handle optimisation has
   * a place to drain without touching the shutdown ordering.
   */
  async close(): Promise<void> {
    // No pooled handles to flush — intentional no-op (see doc comment).
  }

  /**
   * Stage a blob in tmp/, compute its hashes while streaming, then atomically
   * rename to its final destination. Returns size + hashes + final path.
   *
   * Stream lifecycle (abort, backpressure) is the caller's responsibility — the
   * streaming agent wires AbortSignal handling around this method.
   */
  async putBlob(
    bucket: string,
    key: string,
    source: Readable | string,
    cipher?: import('node:crypto').Cipher,
    maxSize?: number,
  ): Promise<PutResult> {
    // Free-space preflight (TASK-2140): reject before opening the staging stream
    // so a nearly-full DATA_DIR can't be pushed over the edge by object writes.
    await this.freeSpace?.assertWritable();

    await this.ensureDir(this.paths.tmpDir());
    const tmpName = `put-${randomUUID()}`;
    const tmpPath = this.paths.tmpPath(tmpName);
    const finalPath = this.paths.blobPath(bucket, key);

    const md5 = createHash('md5');
    const sha = createHash('sha256');
    let bytesWritten = 0n;
    const cap = maxSize !== undefined ? BigInt(maxSize) : undefined;

    const sink = createWriteStream(tmpPath, { flags: 'wx' });
    const input: Readable = typeof source === 'string' ? createReadStream(source) : source;

    try {
      // Hash + count the PLAINTEXT input so ETag/size stay over plaintext; the
      // optional cipher (SSE-S3, STORY-0122) only transforms what hits the disk.
      input.on('data', (chunk: Buffer) => {
        md5.update(chunk);
        sha.update(chunk);
        bytesWritten += BigInt(chunk.length);
        // Abort past the caller's cap (restore decompression bomb, TASK-2143):
        // destroy the source so the pipeline rejects and the tmp file is unlinked
        // in the catch below — the bytes never accumulate on disk.
        if (cap !== undefined && bytesWritten > cap && !input.destroyed) {
          input.destroy(new MaxBlobSizeExceededError(maxSize as number));
        }
      });
      if (cipher) await pipeline(input, cipher, sink);
      else await pipeline(input, sink);
      await this.fsyncFile(tmpPath);
    } catch (err) {
      await this.unlinkQuiet(tmpPath);
      throw err;
    }

    await this.ensureDir(dirname(finalPath));
    await this.atomicRename(tmpPath, finalPath);
    await this.fsyncDir(dirname(finalPath));

    return {
      size: bytesWritten,
      etag: md5.digest('hex'),
      sha256: sha.digest('hex'),
      finalPath,
    };
  }

  /**
   * Stage a multipart part to `multipart/<uploadId>/<N>.part` (§4.4.2). The tmp
   * file carries a `randomUUID()` suffix so two concurrent same-partNumber
   * uploads never collide on the `'wx'` (O_EXCL) open — both write to distinct
   * tmp files and the last `rename(2)` wins atomically (§4.8). Returns the part
   * MD5 (its ETag) and byte count.
   */
  async putPart(
    uploadId: string,
    partNumber: number,
    source: Readable,
  ): Promise<{ etag: string; size: bigint }> {
    // Free-space preflight (TASK-2140): abandoned multipart staging is the other
    // disk-fill vector, so guard part writes too.
    await this.freeSpace?.assertWritable();

    const finalPath = this.paths.multipartPartPath(uploadId, partNumber);
    await this.ensureDir(dirname(finalPath));
    const tmpPath = `${finalPath}.${randomUUID()}.tmp`;

    const md5 = createHash('md5');
    let bytesWritten = 0n;

    const sink = createWriteStream(tmpPath, { flags: 'wx', highWaterMark: 256 * 1024, mode: 0o600 });
    try {
      source.on('data', (chunk: Buffer) => {
        md5.update(chunk);
        bytesWritten += BigInt(chunk.length);
      });
      await pipeline(source, sink);
      await this.fsyncFile(tmpPath);
    } catch (err) {
      await this.unlinkQuiet(tmpPath);
      throw err;
    }

    await this.atomicRename(tmpPath, finalPath); // last-rename-wins
    await this.fsyncDir(dirname(finalPath));
    return { etag: md5.digest('hex'), size: bytesWritten };
  }

  /**
   * Open a read stream for the blob at (bucket, key), optionally constrained
   * to a byte range. Throws ENOENT if the blob is missing — caller maps to
   * `NoSuchKey`.
   */
  async getBlob(
    bucket: string,
    key: string,
    range?: RangeSpec,
  ): Promise<{ stream: ReadStream; size: bigint }> {
    const path = this.paths.blobPath(bucket, key);
    const stat = await fs.stat(path);
    // 256 KB highWaterMark (§4.7): matches Linux readahead / page-cache stride,
    // halving syscall round-trips for files that don't fit in cache.
    const opts: { start?: number; end?: number; highWaterMark: number } = {
      highWaterMark: 256 * 1024,
    };
    if (range) {
      opts.start = range.start;
      if (range.end !== undefined) opts.end = range.end;
    }
    const stream = createReadStream(path, opts);
    return { stream, size: BigInt(stat.size) };
  }

  /** Stat-only — returns null on ENOENT so HEAD callers don't have to catch. */
  async headBlob(bucket: string, key: string): Promise<HeadResult | null> {
    try {
      const stat = await fs.stat(this.paths.blobPath(bucket, key));
      return { size: BigInt(stat.size), mtime: stat.mtime };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw err;
    }
  }

  /**
   * Soft-delete: move the blob into trash/ with a manifest entry. The actual
   * unlink happens in the trash purge background tick (streaming agent).
   */
  async deleteBlob(bucket: string, key: string): Promise<void> {
    const src = this.paths.blobPath(bucket, key);
    await this.ensureDir(this.paths.trashDir());

    const entryId = randomUUID();
    const dst = join(this.paths.trashDir(), entryId);

    try {
      await this.atomicRename(src, dst);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        // Already gone — idempotent.
        return;
      }
      throw err;
    }

    // STORY-0211: explicit interface — keeps the on-disk shape stable for the
    // EPIC-04 trash-purge tick.
    const manifest: TrashManifest = {
      entryId,
      bucket,
      key,
      originalPath: src,
      deletedAt: new Date().toISOString(),
    };
    await fs.writeFile(`${dst}.manifest.json`, JSON.stringify(manifest, null, 2));
  }

  /**
   * Concatenate `parts` into a single blob at (destBucket, destKey). The
   * composed file is staged in tmp/ and renamed, preserving putBlob's atomicity.
   * When `cipher` is supplied (SSE-S3), the composed bytes are encrypted on the
   * way to disk while the ETag/SHA-256/size stay over the plaintext (F5).
   */
  async composeBlobs(
    parts: BlobRef[],
    destBucket: string,
    destKey: string,
    cipher?: import('node:crypto').Cipher,
  ): Promise<PutResult> {
    await this.ensureDir(this.paths.tmpDir());
    const tmpName = `compose-${randomUUID()}`;
    const tmpPath = this.paths.tmpPath(tmpName);
    const finalPath = this.paths.blobPath(destBucket, destKey);

    const md5 = createHash('md5');
    const sha = createHash('sha256');
    let bytesWritten = 0n;

    // Concatenate the parts as one plaintext stream, tapping it for the hashes
    // and byte count before the optional cipher transforms what hits disk.
    const source = Readable.from(
      (async function* () {
        for (const part of parts) {
          for await (const chunk of createReadStream(part.path) as AsyncIterable<Buffer>) {
            md5.update(chunk);
            sha.update(chunk);
            bytesWritten += BigInt(chunk.length);
            yield chunk;
          }
        }
      })(),
    );

    const sink = createWriteStream(tmpPath, { flags: 'wx' });
    try {
      if (cipher) await pipeline(source, cipher, sink);
      else await pipeline(source, sink);
      await this.fsyncFile(tmpPath);
    } catch (err) {
      await this.unlinkQuiet(tmpPath);
      throw err;
    }

    await this.ensureDir(dirname(finalPath));
    await this.atomicRename(tmpPath, finalPath);
    await this.fsyncDir(dirname(finalPath));
    return {
      size: bytesWritten,
      etag: md5.digest('hex'),
      sha256: sha.digest('hex'),
      finalPath,
    };
  }

  // ----- overwrite crash-safety (F2/F3) ----------------------------------

  /** Suffix marking an overwrite backup. Recovery treats these specially. */
  static readonly BACKUP_MARK = '.ob-bak.';

  /**
   * Before an overwrite, hard-link the current blob aside so a failure or crash
   * before the metadata commit can restore it (the overwrite is otherwise
   * destructive-in-place). Returns the backup path, or null when there is no
   * current blob (first write of this key). Hard-link (not copy): the old inode
   * survives the subsequent rename-over, at zero I/O cost.
   */
  async backupCurrentBlob(bucket: string, key: string): Promise<string | null> {
    const finalPath = this.paths.blobPath(bucket, key);
    const backupPath = `${finalPath}${BlobStore.BACKUP_MARK}${randomUUID()}`;
    try {
      await fs.link(finalPath, backupPath);
      return backupPath;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw err;
    }
  }

  /**
   * Restore a backup over the current blob, undoing a failed overwrite. Callers
   * hold the per-key write lock, so dropping the failed new blob first (required
   * because Windows rename won't replace an existing file) is safe.
   */
  async restoreBackupBlob(bucket: string, key: string, backupPath: string): Promise<void> {
    const finalPath = this.paths.blobPath(bucket, key);
    await this.unlinkQuiet(finalPath);
    await this.atomicRename(backupPath, finalPath);
    await this.fsyncDir(dirname(finalPath));
  }

  /** Drop a backup after a successful overwrite (best-effort). */
  async discardBackupBlob(backupPath: string): Promise<void> {
    await this.unlinkQuiet(backupPath);
  }

  // ----- internals -------------------------------------------------------

  private async ensureDir(path: string): Promise<void> {
    await fs.mkdir(path, { recursive: true });
  }

  private async unlinkQuiet(path: string): Promise<void> {
    try {
      await fs.unlink(path);
    } catch {
      /* ignore — best-effort cleanup */
    }
  }

  private async fsyncFile(path: string): Promise<void> {
    const fh = await fs.open(path, 'r+');
    try {
      await fh.sync();
    } finally {
      await fh.close();
    }
  }

  /**
   * fsync a directory so a rename into it is durable across power loss (a
   * `rename(2)` alone syncs neither the entry nor the parent dir). Best-effort:
   * some platforms (notably Windows) can't open/fsync a directory handle — the
   * file's data blocks are already fsync'd, so we tolerate that.
   */
  private async fsyncDir(dir: string): Promise<void> {
    try {
      const fh = await fs.open(dir, 'r');
      try {
        await fh.sync();
      } finally {
        await fh.close();
      }
    } catch {
      /* directory fsync unsupported on this platform — best effort */
    }
  }

  /**
   * `rename(2)` is atomic only on the same filesystem. If `tmp/` and the
   * destination live on different mounts (containerised-volume misconfig),
   * Node returns `EXDEV` — fall back to copy + unlink (not atomic, but correct
   * under the constraint, and noisy in the log so the operator notices).
   */
  private async atomicRename(src: string, dst: string): Promise<void> {
    try {
      await fs.rename(src, dst);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EXDEV') throw err;
      this.log.warn(
        `EXDEV: ${src} -> ${dst} is cross-device. Falling back to copy+unlink. ` +
          'Check that DATA_DIR/tmp and DATA_DIR/blobs share a mount.',
      );
      await fs.copyFile(src, dst);
      await this.fsyncFile(dst);
      await this.fsyncDir(dirname(dst));
      await this.unlinkQuiet(src);
    }
  }
}
