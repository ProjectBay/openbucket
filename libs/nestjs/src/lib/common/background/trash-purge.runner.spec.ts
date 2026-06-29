import { Logger } from '@nestjs/common';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

import type { TrashManifest } from '../../storage/trash';
import { BlobStore } from '../../storage/blob-store';
import { Clock } from '../clock/clock';
import { TRASH_GRACE_MS, TrashPurgeRunner } from './trash-purge.runner';

/**
 * TEST-0322 — TrashPurgeRunner. v1 has no SQLite trash table; the filesystem is
 * the source of truth, so the test drives a real temp `trash/` dir and adapts
 * the plan's "row" wording to the manifest. Verifies grace-period filtering
 * (Clock-driven), blob-before-manifest unlink order, per-entry error tolerance,
 * the setImmediate yield, and re-evaluation after the clock advances.
 */
const NOW = Date.parse('2026-06-15T00:00:00.000Z');
const pastIso = new Date(NOW - TRASH_GRACE_MS - 1000).toISOString(); // expired
const futureIso = new Date(NOW).toISOString(); // deletedAt+grace is in the future

describe('TrashPurgeRunner (TEST-0322)', () => {
  let trashDir: string;
  let now: number;
  let runner: TrashPurgeRunner;

  beforeEach(async () => {
    trashDir = join(process.cwd(), 'tmp', `ob-trash-purge-${randomUUID()}`);
    await fs.mkdir(trashDir, { recursive: true });
    now = NOW;
    const blobs = { paths: { trashDir: () => trashDir } } as unknown as BlobStore;
    const clock = { nowMs: () => now } as unknown as Clock;
    runner = new TrashPurgeRunner(blobs, clock);
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await fs.rm(trashDir, { recursive: true, force: true });
  });

  async function writeEntry(id: string, deletedAt: string): Promise<void> {
    await fs.writeFile(join(trashDir, id), 'blob');
    const manifest: TrashManifest = {
      entryId: id,
      bucket: 'b',
      key: `k-${id}`,
      originalPath: `/blobs/b/k-${id}`,
      deletedAt,
    };
    await fs.writeFile(join(trashDir, `${id}.manifest.json`), JSON.stringify(manifest));
  }

  it('case 1: only entries past their grace period are purged', async () => {
    await writeEntry('p1', pastIso);
    await writeEntry('p2', pastIso);
    await writeEntry('f1', futureIso);

    await runner.run();

    const remaining = (await fs.readdir(trashDir)).sort();
    expect(remaining).toEqual(['f1', 'f1.manifest.json']);
  });

  it('case 2: the blob is unlinked before its manifest', async () => {
    await writeEntry('p1', pastIso);
    const rmSpy = jest.spyOn(fs, 'rm');

    await runner.run();

    const paths = rmSpy.mock.calls.map((c) => String(c[0]));
    const blobIdx = paths.indexOf(join(trashDir, 'p1'));
    const manifestIdx = paths.indexOf(join(trashDir, 'p1.manifest.json'));
    expect(blobIdx).toBeGreaterThanOrEqual(0);
    expect(manifestIdx).toBeGreaterThan(blobIdx);
  });

  it('case 3: a per-entry failure is logged and the sweep continues', async () => {
    await writeEntry('bad', pastIso);
    await writeEntry('ok', pastIso);
    const errSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const realRm = fs.rm;
    jest
      .spyOn(fs, 'rm')
      .mockImplementation((p, o) =>
        String(p) === join(trashDir, 'bad') ? Promise.reject(new Error('boom')) : realRm(p, o),
      );

    await runner.run();

    expect(errSpy).toHaveBeenCalledWith(
      expect.stringContaining('trash-purge: failed to purge bad.manifest.json'),
      expect.anything(),
    );
    // The healthy entry is still fully purged; the failed one's files remain.
    const remaining = (await fs.readdir(trashDir)).sort();
    expect(remaining).toEqual(['bad', 'bad.manifest.json']);
  });

  it('case 4: yields via setImmediate between batches', async () => {
    await writeEntry('p1', pastIso);
    const immediateSpy = jest.spyOn(global, 'setImmediate');

    await runner.run();

    expect(immediateSpy).toHaveBeenCalled();
  });

  it('case 5: a not-yet-expired entry is purged on a later run after the clock advances', async () => {
    // deletedAt just before NOW → expiry (deletedAt + grace) is still in the future.
    await writeEntry('e1', new Date(NOW - 1000).toISOString());

    await runner.run();
    expect(await fs.readdir(trashDir)).toContain('e1');

    now = NOW + TRASH_GRACE_MS; // fast-forward past the grace period
    await runner.run();
    expect(await fs.readdir(trashDir)).not.toContain('e1');
  });

  it('returns quietly when the trash dir does not exist', async () => {
    await fs.rm(trashDir, { recursive: true, force: true });
    await expect(runner.run()).resolves.toBeUndefined();
  });
});
