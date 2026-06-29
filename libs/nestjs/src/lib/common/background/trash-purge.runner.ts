import { Injectable, Logger } from '@nestjs/common';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';

import type { TrashManifest } from '../../storage/trash';
import { BlobStore } from '../../storage/blob-store';
import { Clock } from '../clock/clock';
import { ScheduledTask } from './background.service';

const FIVE_MIN = 5 * 60_000;
const PURGE_BATCH = 500;

/** Grace period after soft-delete before a trash entry is permanently purged.
 *  v1 default (the architecture's "configurable default" — no env knob yet). */
export const TRASH_GRACE_MS = 24 * 60 * 60 * 1000;

/**
 * Permanently removes trash entries past their grace period (§4.9). There is no
 * SQLite trash table in v1 — the filesystem is the source of truth and each
 * `trash/<entryId>` blob has a sibling `trash/<entryId>.manifest.json` (written
 * by `BlobStore.deleteBlob`). This tick reads each manifest, and once
 * `scheduledPurgeAt` (or `deletedAt + TRASH_GRACE_MS`) is reached it unlinks the
 * blob *then* the manifest (so a crash leaves a manifest we retry, never an
 * orphan manifest pointing at a gone blob). Runs every 5 min, reads the Clock so
 * tests can fast-forward, yields between batches, and a per-entry failure is
 * logged without aborting the sweep.
 */
@Injectable()
export class TrashPurgeRunner implements ScheduledTask {
  readonly name = 'trash-purge';
  readonly intervalMs = FIVE_MIN;
  private readonly log = new Logger(TrashPurgeRunner.name);

  constructor(
    private readonly blobs: BlobStore,
    private readonly clock: Clock,
  ) {}

  async run(): Promise<void> {
    const dir = this.blobs.paths.trashDir();
    let names: string[];
    try {
      names = await fs.readdir(dir);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return; // nothing deleted yet
      throw err;
    }

    const manifests = names.filter((n) => n.endsWith('.manifest.json'));
    const now = this.clock.nowMs();
    let purged = 0;

    for (let i = 0; i < manifests.length; i += PURGE_BATCH) {
      for (const manifestName of manifests.slice(i, i + PURGE_BATCH)) {
        const manifestPath = join(dir, manifestName);
        try {
          const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8')) as TrashManifest;
          const purgeAt = manifest.scheduledPurgeAt
            ? Date.parse(manifest.scheduledPurgeAt)
            : Date.parse(manifest.deletedAt) + TRASH_GRACE_MS;
          if (!Number.isFinite(purgeAt) || now < purgeAt) continue; // grace not yet elapsed

          const entryId = manifestName.slice(0, -'.manifest.json'.length);
          // Blob first, then the manifest — a crash mid-purge leaves a retriable
          // manifest, never a manifest pointing at an already-deleted blob.
          await fs.rm(join(dir, entryId), { force: true });
          await fs.rm(manifestPath, { force: true });
          purged++;
        } catch (err) {
          this.log.error(`trash-purge: failed to purge ${manifestName}`, err as Error);
        }
      }
      // Yield to the event loop between batches so request handlers aren't starved.
      await new Promise((r) => setImmediate(r));
    }

    if (purged > 0) {
      this.log.log(`trash-purge: purged ${purged} expired trash entr${purged === 1 ? 'y' : 'ies'}`);
    }
  }
}
