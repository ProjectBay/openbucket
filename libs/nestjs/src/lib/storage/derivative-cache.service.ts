import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream, promises as fs, ReadStream } from 'node:fs';
import { dirname, join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { TransformParams } from '../s3/transforms/transform-params';
import { PathResolver } from './paths';

/** A resolved cache entry: a readable stream over the derivative + its size. */
export interface CacheEntry {
  stream: ReadStream;
  size: number;
}

/** A derivative file discovered by {@link DerivativeCacheService.listEntries}. */
export interface DerivativeEntry {
  path: string;
  size: number;
  mtimeMs: number;
}

/**
 * Content-addressed store for transformed image bytes under
 * `DATA_DIR/derivatives/` (STORY-0800). Keyed on a sha256 of the source ETag +
 * the normalized transform params, so a source overwrite (new ETag) naturally
 * yields a new key — stale entries are simply orphaned and reclaimed by the GC
 * tick (TASK-2404); there is no cache-invalidation race.
 *
 * Writes use the same two-phase durability recipe as {@link BlobStore.putBlob}
 * (stage → fsync → atomic rename → dir fsync) so a torn write is never
 * observable. A per-hash single-flight guard collapses a thundering herd on a
 * cold entry into one (expensive) transform.
 */
@Injectable()
export class DerivativeCacheService {
  private readonly log = new Logger(DerivativeCacheService.name);
  readonly paths: PathResolver;

  /**
   * In-process single-flight: hash → the in-flight produce+put promise. It
   * resolves to `void` (not a CacheEntry) so every caller opens its OWN read
   * stream afterwards — a shared stream could be consumed by only one caller.
   */
  private readonly inFlight = new Map<string, Promise<void>>();

  constructor(config: ConfigService) {
    this.paths = new PathResolver(config.getOrThrow<string>('DATA_DIR'));
  }

  /**
   * Deterministic, collision-resistant cache key = the response ETag. Embeds the
   * source ETag + every normalized param. Deliberately does NOT include the
   * client key/bucket: identical source+params dedupe across keys, and the hash
   * is only ever produced server-side (never client-addressable), so it is not
   * an enumeration oracle.
   */
  static cacheKey(sourceEtag: string, p: TransformParams): string {
    const canonical =
      `${sourceEtag}|w=${p.width ?? ''}|h=${p.height ?? ''}` +
      `|fit=${p.fit}|fmt=${p.format ?? ''}|q=${p.quality}`;
    return createHash('sha256').update(canonical).digest('hex'); // 64 hex chars
  }

  /**
   * Open a read stream + size for a cached derivative, or `null` on a miss
   * (ENOENT) so the caller can decide hit vs. produce.
   */
  async get(hash: string, ext: string): Promise<CacheEntry | null> {
    const path = this.paths.derivativePath(hash, ext);
    let stat: import('node:fs').Stats;
    try {
      stat = await fs.stat(path);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw err;
    }
    return { stream: createReadStream(path, { highWaterMark: 256 * 1024 }), size: stat.size };
  }

  /**
   * Atomically write `bytes` to the derivative path: stage under `tmp/` with an
   * `O_EXCL` open, fsync, rename into place, fsync the dir. Concurrent puts of
   * the same hash are last-rename-wins and idempotent (content is addressed, so
   * both buffers are byte-identical).
   */
  async put(hash: string, ext: string, bytes: Buffer): Promise<void> {
    await fs.mkdir(this.paths.tmpDir(), { recursive: true });
    const tmpPath = this.paths.tmpPath(`deriv-${randomUUID()}`);
    const finalPath = this.paths.derivativePath(hash, ext);

    const sink = createWriteStream(tmpPath, { flags: 'wx', mode: 0o600 });
    try {
      await pipeline(Readable.from(bytes), sink);
      await this.fsyncFile(tmpPath);
    } catch (err) {
      await this.unlinkQuiet(tmpPath);
      throw err;
    }

    await fs.mkdir(dirname(finalPath), { recursive: true });
    try {
      await fs.rename(tmpPath, finalPath);
    } catch (err) {
      await this.unlinkQuiet(tmpPath);
      throw err;
    }
    await this.fsyncDir(dirname(finalPath));
  }

  /**
   * Single-flight producer. Ensures `produce` (the expensive transform) runs at
   * most once per hash across a concurrent burst, then returns a **fresh** cache
   * entry (its own read stream) for THIS caller:
   *  1. Fast path: a disk hit short-circuits, no production.
   *  2. Otherwise join (or start) the one in-flight produce→put for this hash.
   *  3. After it settles, open this caller's own stream via `get`.
   */
  async getOrCreate(
    hash: string,
    ext: string,
    produce: () => Promise<Buffer>,
  ): Promise<CacheEntry> {
    const hit = await this.get(hash, ext);
    if (hit) return hit;

    await this.produceOnce(hash, ext, produce);

    const entry = await this.get(hash, ext);
    if (!entry) {
      // Should be impossible (we just produced+put it) — surface loudly.
      throw new Error(`derivative vanished immediately after put: ${hash}.${ext}`);
    }
    return entry;
  }

  /**
   * Run produce→put for `hash` at most once across concurrent callers. Stores an
   * in-flight promise so a burst collapses onto one production, re-checks disk
   * under the guard (a producer may have finished between the caller's miss and
   * taking the slot), and clears the map entry in `finally` (win or lose).
   */
  private produceOnce(hash: string, ext: string, produce: () => Promise<Buffer>): Promise<void> {
    const existing = this.inFlight.get(hash);
    if (existing) return existing;

    const promise = (async (): Promise<void> => {
      const raced = await this.get(hash, ext);
      if (raced) {
        raced.stream.destroy(); // already on disk — release the probe fd
        return;
      }
      const bytes = await produce();
      await this.put(hash, ext, bytes);
    })().finally(() => {
      this.inFlight.delete(hash);
    });

    this.inFlight.set(hash, promise);
    return promise;
  }

  /**
   * Async iterator over every derivative file (for the GC sweep). Yields
   * `{ path, size, mtimeMs }`. Returns nothing when the store dir is absent
   * (feature never used) — ENOENT is tolerated like `trash-purge`.
   */
  async *listEntries(): AsyncGenerator<DerivativeEntry> {
    const root = this.paths.derivativesDir();
    let shards: string[];
    try {
      shards = await fs.readdir(root);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw err;
    }
    for (const shard of shards) {
      const shardDir = join(root, shard);
      let files: string[];
      try {
        files = await fs.readdir(shardDir);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') continue;
        throw err;
      }
      for (const file of files) {
        const path = join(shardDir, file);
        try {
          const stat = await fs.stat(path);
          if (stat.isFile()) yield { path, size: stat.size, mtimeMs: stat.mtimeMs };
        } catch (err) {
          if ((err as NodeJS.ErrnoException).code === 'ENOENT') continue;
          throw err;
        }
      }
    }
  }

  /** Best-effort unlink of a derivative file; ENOENT is ignored (idempotent). */
  async evict(path: string): Promise<void> {
    try {
      await fs.rm(path, { force: true });
    } catch (err) {
      // force:true already swallows ENOENT; log anything else (e.g. Windows
      // EBUSY on an open fd) and let the next tick retry.
      this.log.warn(`derivative evict failed for ${path}: ${(err as Error).message}`);
    }
  }

  /**
   * Bump a hit's mtime so LRU eviction (TASK-2404) treats a recently-served
   * derivative as fresh. Best-effort — a failure just means the entry ages by
   * write time instead.
   */
  async touch(hash: string, ext: string): Promise<void> {
    const path = this.paths.derivativePath(hash, ext);
    const now = new Date();
    try {
      await fs.utimes(path, now, now);
    } catch {
      /* best-effort — LRU falls back to write-time ordering */
    }
  }

  // ----- internals (mirror BlobStore's durability helpers) ---------------

  private async unlinkQuiet(path: string): Promise<void> {
    try {
      await fs.unlink(path);
    } catch {
      /* best-effort cleanup */
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
}
