import { BadRequestException, HttpException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createWriteStream, promises as fs } from 'node:fs';
import { join, posix } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Readable, type Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { once } from 'node:events';
import type { Response } from 'express';
import archiver from 'archiver';
import yauzl from 'yauzl';

import { BucketService } from '../../domain/buckets/bucket.service';
import { ObjectService } from '../../domain/objects/object.service';
import { ObjectWriterService } from '../../storage/object-writer.service';
import { MaxBlobSizeExceededError } from '../../storage/blob-store';
import { BucketRepository } from '../../persistence/repositories/bucket.repository';
import { ObjectRepository } from '../../persistence/repositories/object.repository';
import { VersioningState } from '../../persistence/index';
import { NoSuchBucketError } from '../../s3/errors/s3-error';

/** On-disk backup archive format (v1). Portable back into any OpenBucket. */
interface BackupManifest {
  version: 1;
  kind: 'bucket' | 'instance';
  createdAt: string;
  /** Bucket configs captured (versioning + object-lock restored on reset; the
   *  rest is informational for v1). */
  buckets: Array<{
    name: string;
    versioning: 'enabled' | 'disabled';
    objectLock: boolean;
    region: string;
  }>;
  /** Every object, keyed by (bucket,key). Payloads live at `data/<bucket>/<key>`. */
  objects: Array<{
    bucket: string;
    key: string;
    size: number;
    etag: string;
    contentType: string;
    userMetadata?: Record<string, string>;
    tagging?: Record<string, string>;
  }>;
}

const PAGE = 1000;
const DATA_PREFIX = 'data/';

@Injectable()
export class BackupService {
  private readonly log = new Logger(BackupService.name);

  constructor(
    private readonly buckets: BucketService,
    private readonly bucketRepo: BucketRepository,
    private readonly objects: ObjectService,
    private readonly objectRepo: ObjectRepository,
    private readonly writer: ObjectWriterService,
    private readonly config: ConfigService,
  ) {}

  // ===== BACKUP (stream a .zip download) ================================

  /** Stream a .zip of one bucket (its config + every object) to the response. */
  async streamBucketBackup(bucket: string, res: Response): Promise<void> {
    const row = await this.bucketRepo.getByName(bucket);
    if (!row) throw new NoSuchBucketError(bucket);
    await this.streamBackup(res, `openbucket-${bucket}-backup.zip`, 'bucket', [row.name]);
  }

  /** Stream a .zip of the whole instance (all buckets + all objects). */
  async streamInstanceBackup(res: Response): Promise<void> {
    const all = await this.bucketRepo.listAll();
    await this.streamBackup(
      res,
      `openbucket-instance-backup.zip`,
      'instance',
      all.map((b) => b.name),
    );
  }

  private async streamBackup(
    res: Response,
    filename: string,
    kind: 'bucket' | 'instance',
    bucketNames: string[],
  ): Promise<void> {
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    // Retain the archiver handle so a client disconnect can abort it mid-stream
    // (stops reading blobs). The single archive-creation site lives in
    // `writeSnapshot`; the wrapper only owns the HTTP concerns (headers, abort).
    let archive: archiver.Archiver | undefined;
    res.on('close', () => {
      if (!res.writableFinished) archive?.abort();
    });

    try {
      await this.writeSnapshot(res, kind, bucketNames, (a) => {
        archive = a;
      });
    } catch (err) {
      // On the download path a failed archive must tear down the response (the
      // file path instead rejects so the runner unlinks its partial `.part`).
      this.log.error(`backup archive error: ${(err as Error).message}`);
      if (!res.headersSent) res.status(500);
      if (!res.destroyed) res.destroy(err as Error);
    }
  }

  /**
   * Build the backup `.zip` (identical `BackupManifest` v1 + per-object data
   * entries) into any `Writable` sink — the streamed HTTP response OR a file on
   * disk (the scheduled runner). This is the single seam both callers share.
   *
   * Streams each object via {@link ObjectService.openObjectStream} with the same
   * one-fd-at-a-time backpressure (`await once(archive, 'entry')`), appends
   * `manifest.json`, and finalizes. Returns the snapshot's size (`bytes`, from
   * `archive.pointer()` after finalize — no re-`stat`) and `objectCount` (from
   * `manifest.objects.length`). An archiver error rejects the returned promise so
   * a file-sink caller can mark the run failed and remove the partial `.part`.
   *
   * `onArchive` hands the caller the `archiver` handle (e.g. to `abort()` on a
   * client disconnect) while keeping one archive-creation site here.
   */
  async writeSnapshot(
    sink: Writable,
    kind: 'bucket' | 'instance',
    bucketNames: string[],
    onArchive?: (archive: archiver.Archiver) => void,
  ): Promise<{ bytes: number; objectCount: number }> {
    const archive = archiver('zip', { zlib: { level: 1 } });
    onArchive?.(archive);

    // Capture the first archiver error and rethrow it after the current await
    // unwinds, so a failure rejects the returned promise (file path) instead of
    // silently truncating the archive.
    let failed: Error | undefined;
    archive.on('error', (err) => {
      failed = err as Error;
    });
    archive.pipe(sink);

    const manifest: BackupManifest = {
      version: 1,
      kind,
      createdAt: new Date().toISOString(),
      buckets: [],
      objects: [],
    };

    for (const name of bucketNames) {
      const b = await this.bucketRepo.getByName(name);
      if (!b) continue; // bucket deleted mid-scan — tolerate
      manifest.buckets.push({
        name: b.name,
        versioning: b.versioning === VersioningState.Enabled ? 'enabled' : 'disabled',
        objectLock: !!b.objectLock?.enabled,
        region: b.region ?? 'us-east-1',
      });

      let marker: string | undefined;
      do {
        if (failed) throw failed;
        const { rows, truncated } = await this.objectRepo.listByPrefix(name, '', marker, PAGE);
        for (const obj of rows) {
          if (obj.softDeleted) continue;
          manifest.objects.push({
            bucket: name,
            key: obj.key,
            size: Number(obj.size),
            etag: obj.etag,
            contentType: obj.contentType,
            userMetadata: obj.userMetadata ?? undefined,
            tagging: obj.tagging ?? undefined,
          });
          const opened = await this.objects.openObjectStream(name, obj.key);
          if (!opened) continue; // metadata row without a blob (e.g. delete marker) — skip
          // Append + wait for archiver to consume this entry before opening the
          // next blob, so we never hold more than one fd open at a time.
          archive.append(opened.stream, { name: `${DATA_PREFIX}${name}/${obj.key}` });
          await once(archive, 'entry');
        }
        marker = truncated && rows.length ? rows[rows.length - 1].key : undefined;
      } while (marker);
    }

    if (failed) throw failed;
    archive.append(JSON.stringify(manifest, null, 2), { name: 'manifest.json' });
    await archive.finalize();
    if (failed) throw failed;

    // `archive.pointer()` is the total bytes written to the sink after finalize —
    // the snapshot size without re-stat'ing the file.
    return { bytes: archive.pointer(), objectCount: manifest.objects.length };
  }

  // ===== RESTORE (upload a .zip → reset target to it) ===================

  /** Reset one bucket (`target`) to the contents of an uploaded backup .zip. */
  async restoreBucket(target: string, upload: Readable): Promise<{ objectsRestored: number }> {
    this.assertSafeBucket(target);
    const zipPath = await this.spool(upload);
    try {
      const manifest = await this.readManifest(zipPath);
      if (manifest.buckets.length === 0) throw new BadRequestException('backup contains no bucket');
      // A bucket backup carries exactly one source bucket; restore its objects
      // into `target` (remapping the bucket name), resetting `target` first.
      const source = manifest.buckets[0];
      // Validate the whole archive (decompression caps + entry count) BEFORE any
      // destructive wipe (TASK-2143), so a bomb/oversize archive is rejected with
      // the existing objects still intact.
      await this.validateArchive(zipPath);
      await this.ensureBucket(target, source);
      await this.wipeBucketObjects(target);

      let restored = 0;
      await this.forEachObjectEntry(zipPath, async (entryBucket, key, stream) => {
        if (entryBucket !== source.name) {
          stream.resume(); // ignore stray buckets in a single-bucket restore
          return;
        }
        await this.restoreObject(target, key, stream, manifest);
        restored++;
      });
      this.log.log(`restored ${restored} object(s) into bucket '${target}'`);
      return { objectsRestored: restored };
    } finally {
      await fs.rm(zipPath, { force: true });
    }
  }

  /** Reset the WHOLE instance to the contents of an uploaded backup .zip. */
  async restoreInstance(upload: Readable): Promise<{ bucketsRestored: number; objectsRestored: number }> {
    const zipPath = await this.spool(upload);
    try {
      const manifest = await this.readManifest(zipPath);
      // Validate decompression caps BEFORE wiping the live instance (TASK-2143):
      // the prior code wiped every bucket first, so a bomb that tripped mid-write
      // left the instance both wiped AND un-restored (data loss). Fully validating
      // the archive up front makes a hostile archive a no-op against live data.
      await this.validateArchive(zipPath);
      // Reset: wipe every existing bucket, then recreate from the manifest.
      const existing = await this.bucketRepo.listAll();
      for (const b of existing) {
        await this.wipeBucketObjects(b.name);
        await this.buckets.deleteByName(b.name).catch(() => undefined);
      }
      for (const b of manifest.buckets) {
        await this.ensureBucket(b.name, b);
      }
      let restored = 0;
      await this.forEachObjectEntry(zipPath, async (bucket, key, stream) => {
        await this.restoreObject(bucket, key, stream, manifest);
        restored++;
      });
      this.log.log(`restored ${manifest.buckets.length} bucket(s), ${restored} object(s)`);
      return { bucketsRestored: manifest.buckets.length, objectsRestored: restored };
    } finally {
      await fs.rm(zipPath, { force: true });
    }
  }

  // ===== internals ======================================================

  /** S3-style bucket name (also rejects any '..'), the write path's directory. */
  private static readonly BUCKET_RE = /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/;

  private assertSafeBucket(name: string): void {
    // Guard the RAW value (barriers the taint analysis recognises: includes('..'),
    // isAbsolute) plus the strict S3 bucket allowlist.
    if (
      name.includes('..') ||
      name.includes('/') ||
      name.includes('\\') ||
      name.includes('\0') ||
      posix.isAbsolute(name) ||
      !BackupService.BUCKET_RE.test(name)
    ) {
      throw new BadRequestException(`unsafe bucket name in backup archive: ${JSON.stringify(name)}`);
    }
  }

  /**
   * Reject object keys from an uploaded archive that could escape the bucket
   * directory when written (path traversal / Zip Slip). Guards the RAW key so
   * the taint analysis recognises the barrier: any '..' (even as a substring),
   * absolute paths, leading '/', backslashes, or NUL. This rejects the rare key
   * that literally contains '..' — an acceptable trade for a hard traversal
   * guarantee (encodeKey also neutralises these on disk).
   */
  private assertSafeKey(key: string): void {
    if (
      key.length === 0 ||
      key.includes('..') ||
      key.includes('\0') ||
      key.includes('\\') ||
      posix.isAbsolute(key) ||
      key.startsWith('/')
    ) {
      throw new BadRequestException(`unsafe object key in backup archive: ${JSON.stringify(key)}`);
    }
  }

  private async ensureBucket(
    name: string,
    cfg: BackupManifest['buckets'][number],
  ): Promise<void> {
    this.assertSafeBucket(name);
    if (await this.bucketRepo.exists(name)) return;
    await this.buckets.create({
      name,
      versioning: cfg.versioning,
      objectLock: cfg.objectLock,
      region: cfg.region ?? 'us-east-1',
    });
  }

  private async wipeBucketObjects(bucket: string): Promise<void> {
    // Inline traversal barrier before the delete path touches fs (trash move).
    if (bucket.includes('..') || bucket.includes('/') || bucket.includes('\\') || posix.isAbsolute(bucket)) {
      throw new BadRequestException(`unsafe bucket name in backup archive: ${JSON.stringify(bucket)}`);
    }
    for (;;) {
      const { rows } = await this.objectRepo.listByPrefix(bucket, '', undefined, PAGE);
      const live = rows.filter((r) => !r.softDeleted);
      if (live.length === 0) break;
      for (const r of live) {
        await this.objects.deleteOne(bucket, r.key, undefined, true).catch((e) =>
          this.log.warn(`wipe: could not delete ${bucket}/${r.key}: ${(e as Error).message}`),
        );
      }
    }
  }

  private async restoreObject(
    bucket: string,
    key: string,
    stream: Readable,
    manifest: BackupManifest,
  ): Promise<void> {
    // Inline, sink-adjacent traversal barrier on the RAW values (the form the
    // taint analysis recognises) immediately before the writer's fs paths.
    if (
      bucket.includes('..') ||
      bucket.includes('/') ||
      bucket.includes('\\') ||
      key.includes('..') ||
      key.includes('\0') ||
      key.includes('\\') ||
      posix.isAbsolute(key) ||
      key.startsWith('/')
    ) {
      throw new BadRequestException(`unsafe path in backup archive: ${JSON.stringify(`${bucket}/${key}`)}`);
    }
    const meta = manifest.objects.find((o) => o.bucket === bucket && o.key === key);
    // Per-entry decompression cap (TASK-2143): abort + unlink the staging file if
    // the entry decompresses past the limit, so a bomb can't fill the disk.
    let row;
    try {
      row = await this.writer.put({
        bucket,
        key,
        body: stream,
        contentType: meta?.contentType,
        userMetadata: meta?.userMetadata,
        maxSize: this.config.getOrThrow<number>('RESTORE_MAX_ENTRY_BYTES'),
      });
    } catch (err) {
      if (err instanceof MaxBlobSizeExceededError) {
        throw new BadRequestException(
          `object '${bucket}/${key}' in backup archive exceeds the per-entry size limit`,
        );
      }
      throw err;
    }
    // Cross-check the observed plaintext size against the manifest's declared size
    // (TASK-2143): catches a manifest that under-declares a bomb entry.
    if (meta && row.size !== BigInt(meta.size)) {
      throw new BadRequestException(
        `object '${bucket}/${key}' size (${row.size}) does not match manifest (${meta.size})`,
      );
    }
    if (meta?.tagging && Object.keys(meta.tagging).length > 0) {
      await this.objects.setTaggingMap(bucket, key, meta.tagging).catch(() => undefined);
    }
  }

  /** Spool the upload to a temp .zip on disk (streamed, not buffered in RAM). */
  private async spool(upload: Readable): Promise<string> {
    const dir = join(this.config.getOrThrow<string>('DATA_DIR'), 'tmp');
    await fs.mkdir(dir, { recursive: true });
    const path = join(dir, `restore-${randomUUID()}.zip`);
    await pipeline(upload, createWriteStream(path));
    return path;
  }

  /** Read + parse manifest.json without reading any object payloads. */
  private async readManifest(zipPath: string): Promise<BackupManifest> {
    let manifest: BackupManifest | undefined;
    await this.readZip(zipPath, async (name, openStream) => {
      if (name.startsWith(DATA_PREFIX)) {
        // Validate every payload entry name up front so a hostile archive is
        // rejected BEFORE any destructive wipe (fail-fast Zip Slip guard).
        const rest = name.slice(DATA_PREFIX.length);
        const slash = rest.indexOf('/');
        if (slash > 0) {
          this.assertSafeBucket(rest.slice(0, slash));
          this.assertSafeKey(rest.slice(slash + 1));
        }
        return; // don't open payload streams during the manifest pass
      }
      if (name !== 'manifest.json') return;
      // Cap the buffered manifest read (TASK-2144, CWE-400/789): unlike object
      // payloads (streamed), manifest.json is fully buffered before JSON.parse,
      // so a hostile archive could ship a manifest that decompresses to many GB
      // and OOM-crashes the process. Abort mid-stream once the cap is exceeded so
      // the oversized buffer never materializes.
      const cap = this.config.getOrThrow<number>('RESTORE_MAX_MANIFEST_BYTES');
      let total = 0;
      const chunks: Buffer[] = [];
      const rs = await openStream();
      for await (const c of rs) {
        total += (c as Buffer).length;
        if (total > cap) {
          rs.destroy();
          throw new BadRequestException('manifest.json in backup archive is too large');
        }
        chunks.push(c as Buffer);
      }
      try {
        manifest = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      } catch {
        throw new BadRequestException('invalid manifest.json in backup archive (not JSON)');
      }
    });
    if (!manifest || manifest.version !== 1 || !Array.isArray(manifest.buckets)) {
      throw new BadRequestException('invalid or missing manifest.json in backup archive');
    }
    return manifest;
  }

  /** Iterate object payload entries (`data/<bucket>/<key>`) with their streams. */
  private async forEachObjectEntry(
    zipPath: string,
    handler: (bucket: string, key: string, stream: Readable) => Promise<void>,
  ): Promise<void> {
    await this.readZip(zipPath, async (name, openStream) => {
      if (!name.startsWith(DATA_PREFIX)) return;
      const rest = name.slice(DATA_PREFIX.length);
      const slash = rest.indexOf('/');
      if (slash <= 0) return; // malformed
      const bucket = rest.slice(0, slash);
      const key = rest.slice(slash + 1);
      if (!key) return;
      // Untrusted archive: validate before any value reaches a filesystem sink.
      this.assertSafeBucket(bucket);
      this.assertSafeKey(key);
      const rs = await openStream();
      await handler(bucket, key, rs);
    });
  }

  /**
   * Dry-run pass over every payload entry that enforces the decompression caps
   * (TASK-2143, CWE-409/400) WITHOUT writing anything: per-entry byte cap, total
   * decompressed byte cap, and entry-count cap. Streams (and discards) each entry
   * so the caps are enforced against the ACTUAL decompressed byte count, not a
   * (spoofable) zip header. Run before any destructive wipe so a bomb archive is
   * rejected with the live instance untouched.
   */
  private async validateArchive(zipPath: string): Promise<void> {
    const maxEntry = BigInt(this.config.getOrThrow<number>('RESTORE_MAX_ENTRY_BYTES'));
    const maxTotal = BigInt(this.config.getOrThrow<number>('RESTORE_MAX_TOTAL_BYTES'));
    const maxEntries = this.config.getOrThrow<number>('RESTORE_MAX_ENTRIES');
    let total = 0n;
    let count = 0;

    await this.forEachObjectEntry(zipPath, async (bucket, key, stream) => {
      count += 1;
      if (count > maxEntries) {
        stream.destroy();
        throw new BadRequestException(`backup archive has too many entries (limit ${maxEntries})`);
      }
      let observed = 0n;
      for await (const chunk of stream) {
        observed += BigInt((chunk as Buffer).length);
        if (observed > maxEntry) {
          stream.destroy();
          throw new BadRequestException(
            `object '${bucket}/${key}' in backup archive exceeds the per-entry size limit`,
          );
        }
        if (total + observed > maxTotal) {
          stream.destroy();
          throw new BadRequestException('backup archive exceeds the total decompressed size limit');
        }
      }
      total += observed;
    });
  }

  /**
   * Serial zip reader. Calls `onEntry` for each file entry; the handler decides
   * whether to read the entry's data (call `openStream()`) or skip it (cheap —
   * yauzl seeks past unread entries). Entries are processed one at a time.
   */
  private async readZip(
    zipPath: string,
    onEntry: (name: string, openStream: () => Promise<Readable>) => Promise<void>,
  ): Promise<void> {
    // A failure to open/parse the archive is bad *input* (400), not a server fault.
    const badZip = (msg: string) => new BadRequestException(`invalid backup archive: ${msg}`);
    const zipfile = await new Promise<yauzl.ZipFile>((resolve, reject) =>
      yauzl.open(zipPath, { lazyEntries: true }, (err, zf) =>
        err || !zf ? reject(badZip('not a readable .zip')) : resolve(zf),
      ),
    );
    try {
      await new Promise<void>((resolve, reject) => {
        // Preserve our own HttpExceptions (e.g. the Zip Slip guard) as-is; map
        // raw yauzl/zlib parse errors to 400 rather than surfacing a 500.
        const fail = (e: unknown) => reject(e instanceof HttpException ? e : badZip('corrupt archive'));
        zipfile.on('error', fail);
        zipfile.on('end', () => resolve());
        zipfile.on('entry', (entry: yauzl.Entry) => {
          if (entry.fileName.endsWith('/')) {
            zipfile.readEntry();
            return;
          }
          const openStream = (): Promise<Readable> =>
            new Promise((res, rej) =>
              zipfile.openReadStream(entry, (err, rs) => (err || !rs ? rej(badZip('corrupt entry')) : res(rs))),
            );
          onEntry(entry.fileName, openStream)
            .then(() => zipfile.readEntry())
            .catch(fail);
        });
        zipfile.readEntry();
      });
    } finally {
      zipfile.close();
    }
  }
}
