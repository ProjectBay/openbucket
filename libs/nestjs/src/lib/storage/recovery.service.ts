import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { EntityManager } from '@mikro-orm/better-sqlite';
import { InjectEntityManager } from '@mikro-orm/nestjs';
import { promises as fs } from 'node:fs';
import { join, relative, sep } from 'node:path';

import { ConfigService } from '@nestjs/config';

import { MultipartUpload, ObjectEntity } from '../persistence/index';
import { OPEN_BUCKET_ORM_CONTEXT } from '../persistence/orm-context';

import { PathResolver } from './paths';
import { decodeKey } from './key-codec';
import { BlobStore } from './blob-store';

export interface OrphanReport {
  orphanBlobs: { path: string; bucket: string; key: string }[];
  removedMultipartDirs: string[];
  /** Overwrite backups reconciled after a crash: restored (old kept) or discarded. */
  reconciledBackups: { restored: number; discarded: number };
  scanned: { blobs: number; multipart: number };
}

/**
 * Startup crash-recovery scan (WHITEPAPER §3.8). Runs once at boot, before
 * the HTTP listener binds (`OnApplicationBootstrap` precedes `app.listen()`).
 *
 * Two passes:
 *   1. Blob pass: walk `blobs/<bucket>/...`, skip `*.v/` version dirs, decode
 *      filenames to raw keys, and compare to the `objects` table. Misses go
 *      into `orphanBlobs` — logged, **never deleted** in v1. Rationale: a
 *      misconfigured `DATA_DIR` (operator points the container at the wrong
 *      volume) would otherwise nuke real data. A future `--repair` mode can
 *      unlink after confirmation.
 *   2. Multipart pass: walk `multipart/<uploadId>/`. Directories whose
 *      `uploadId` is not in `multipart_uploads` are removed wholesale (the
 *      upload state is gone; the parts cannot be resumed).
 */
@Injectable()
export class RecoveryService implements OnApplicationBootstrap {
  private readonly log = new Logger(RecoveryService.name);
  private readonly paths: PathResolver;

  constructor(
    @InjectEntityManager(OPEN_BUCKET_ORM_CONTEXT) private readonly em: EntityManager,
    config: ConfigService,
  ) {
    this.paths = new PathResolver(config.getOrThrow<string>('DATA_DIR'));
  }

  async onApplicationBootstrap(): Promise<void> {
    const t0 = Date.now();
    const report = await this.runScan();
    this.log.log(
      `recovery scan: ${report.scanned.blobs} blobs, ${report.scanned.multipart} multipart dirs ` +
        `in ${Date.now() - t0}ms; ${report.orphanBlobs.length} orphan blobs, ` +
        `${report.removedMultipartDirs.length} stale multipart dirs cleaned, ` +
        `${report.reconciledBackups.restored} overwrite(s) restored / ` +
        `${report.reconciledBackups.discarded} backup(s) discarded`,
    );
    if (report.orphanBlobs.length > 0) {
      // Log first 50 so the operator can investigate without grepping disk.
      for (const o of report.orphanBlobs.slice(0, 50)) {
        this.log.warn(`orphan blob: bucket=${o.bucket} key=${o.key} path=${o.path}`);
      }
    }
  }

  async runScan(): Promise<OrphanReport> {
    const orphanBlobs: OrphanReport['orphanBlobs'] = [];
    const removedMultipartDirs: string[] = [];
    const reconciledBackups = { restored: 0, discarded: 0 };
    let blobsScanned = 0;
    let multipartScanned = 0;

    // The scan runs at bootstrap, outside any request context; fork a
    // dedicated EM so its reads don't touch the disallowed global context
    // (allowGlobalContext: false). Required once blobs exist on disk.
    const em = this.em.fork();

    // ----- blob pass -----------------------------------------------------
    const blobsRoot = this.paths.blobsDir();
    if (await this.exists(blobsRoot)) {
      const bucketDirs = await fs.readdir(blobsRoot, { withFileTypes: true });
      for (const bucketDirent of bucketDirs) {
        if (!bucketDirent.isDirectory()) continue;
        const bucket = bucketDirent.name;
        const bucketRoot = join(blobsRoot, bucket);
        for await (const filePath of this.walk(bucketRoot)) {
          blobsScanned++;
          // Skip version-store directories — reconciled via ObjectVersion rows.
          const rel = relative(bucketRoot, filePath);
          if (rel.includes('.v' + sep) || rel.includes('.v/')) continue;

          // Overwrite backup left by a crash (F2/F3): reconcile against the row
          // instead of treating it as an orphan/key.
          if (rel.includes(BlobStore.BACKUP_MARK)) {
            const outcome = await this.reconcileBackup(em, bucket, bucketRoot, filePath, rel);
            if (outcome === 'restored') reconciledBackups.restored++;
            else reconciledBackups.discarded++;
            continue;
          }

          const decoded = decodeKey(rel.replaceAll('\\', '/'));
          const row = await em.findOne(
            ObjectEntity,
            { bucket: { name: bucket }, key: decoded },
            { fields: ['id'] },
          );
          if (!row) {
            orphanBlobs.push({ path: filePath, bucket, key: decoded });
          }
        }
      }
    }

    // ----- multipart pass ------------------------------------------------
    const mpRoot = this.paths.multipartRoot();
    if (await this.exists(mpRoot)) {
      const uploadDirs = await fs.readdir(mpRoot, { withFileTypes: true });
      for (const d of uploadDirs) {
        if (!d.isDirectory()) continue;
        multipartScanned++;
        const uploadId = d.name;
        const row = await em.findOne(
          MultipartUpload,
          { uploadId },
          { fields: ['uploadId'] },
        );
        if (!row) {
          const dirPath = join(mpRoot, uploadId);
          await fs.rm(dirPath, { recursive: true, force: true });
          removedMultipartDirs.push(dirPath);
        }
      }
    }

    return {
      orphanBlobs,
      removedMultipartDirs,
      reconciledBackups,
      scanned: { blobs: blobsScanned, multipart: multipartScanned },
    };
  }

  /**
   * Reconcile an overwrite backup (`<blob>.ob-bak.<uuid>`) left by a crash
   * mid-overwrite. The committed row is the source of truth:
   *  - no row → object gone; discard the backup.
   *  - current blob missing, or its size ≠ the row's size (an uncommitted new
   *    blob sitting where the committed old one should be) → restore the backup.
   *  - sizes match → the overwrite committed (or a same-size overwrite that
   *    getObject's read-time hash check backstops); discard the backup.
   * Size (not hash) keeps recovery cheap and cipher-agnostic (stream ciphers
   * preserve length); the read-time integrity check catches same-size mismatches.
   */
  private async reconcileBackup(
    em: EntityManager,
    bucket: string,
    bucketRoot: string,
    backupPath: string,
    rel: string,
  ): Promise<'restored' | 'discarded'> {
    const finalRel = rel.slice(0, rel.lastIndexOf(BlobStore.BACKUP_MARK));
    const key = decodeKey(finalRel.replaceAll('\\', '/'));
    const finalPath = join(bucketRoot, finalRel);
    const row = await em.findOne(
      ObjectEntity,
      { bucket: { name: bucket }, key },
      { fields: ['id', 'size'] },
    );
    if (!row) {
      await fs.rm(backupPath, { force: true });
      return 'discarded';
    }
    let finalSize = -1;
    try {
      finalSize = (await fs.stat(finalPath)).size;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
    if (finalSize === -1 || finalSize !== Number(row.size)) {
      // Uncommitted overwrite — put the committed old blob back.
      await fs.rm(finalPath, { force: true });
      await fs.rename(backupPath, finalPath);
      this.log.warn(`reconciled interrupted overwrite: restored ${bucket}/${key}`);
      return 'restored';
    }
    await fs.rm(backupPath, { force: true });
    return 'discarded';
  }

  private async *walk(root: string): AsyncIterable<string> {
    const stack: string[] = [root];
    while (stack.length > 0) {
      const dir = stack.pop()!;
      let entries: import('node:fs').Dirent[];
      try {
        entries = await fs.readdir(dir, { withFileTypes: true });
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') continue;
        throw err;
      }
      for (const ent of entries) {
        const p = join(dir, ent.name);
        if (ent.isDirectory()) {
          stack.push(p);
        } else if (ent.isFile()) {
          yield p;
        }
      }
    }
  }

  private async exists(path: string): Promise<boolean> {
    try {
      await fs.access(path);
      return true;
    } catch {
      return false;
    }
  }
}
