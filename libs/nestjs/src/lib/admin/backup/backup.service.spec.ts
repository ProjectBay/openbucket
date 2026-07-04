import { BadRequestException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { createReadStream, createWriteStream, promises as fs } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import archiver from 'archiver';

import type { BucketService } from '../../domain/buckets/bucket.service';
import type { ObjectService } from '../../domain/objects/object.service';
import type { ObjectWriterService } from '../../storage/object-writer.service';
import type { BucketRepository } from '../../persistence/repositories/bucket.repository';
import type { ObjectRepository } from '../../persistence/repositories/object.repository';
import { BackupService } from './backup.service';

/**
 * TEST-0704 — restore decompression caps (TASK-2143, CWE-409/400) + manifest
 * read cap (TASK-2144, CWE-400/789). Archives are built on disk with archiver
 * and streamed back through the real yauzl-based restore path.
 */
const CAPS = {
  RESTORE_MAX_MANIFEST_BYTES: 4 * 1024 * 1024,
  RESTORE_MAX_ENTRY_BYTES: 5 * 1024 * 1024 * 1024,
  RESTORE_MAX_TOTAL_BYTES: 100 * 1024 * 1024 * 1024,
  RESTORE_MAX_ENTRIES: 1_000_000,
};

describe('BackupService restore caps (TEST-0704)', () => {
  let dataDir: string;
  let caps: Record<string, number>;
  const wipeSpy = jest.fn();

  const validManifest = () =>
    JSON.stringify({
      version: 1,
      kind: 'bucket',
      createdAt: new Date().toISOString(),
      buckets: [{ name: 'mybucket', versioning: 'disabled', objectLock: false, region: 'us-east-1' }],
      objects: [{ bucket: 'mybucket', key: 'f.txt', size: 5, etag: '', contentType: 'text/plain' }],
    });

  /** Build a .zip on disk from { name → Buffer } entries; returns its path. */
  async function makeZip(entries: Record<string, Buffer>): Promise<string> {
    const zipPath = join(dataDir, `archive-${randomUUID()}.zip`);
    const out = createWriteStream(zipPath);
    const archive = archiver('zip', { zlib: { level: 0 } });
    archive.pipe(out);
    for (const [name, buf] of Object.entries(entries)) archive.append(buf, { name });
    await archive.finalize();
    await once(out, 'close');
    return zipPath;
  }

  function makeService(): BackupService {
    const config = {
      getOrThrow: (k: string) => (k === 'DATA_DIR' ? dataDir : caps[k]),
    } as unknown as ConfigService;

    const bucketRepo = {
      getByName: jest.fn().mockResolvedValue({ name: 'mybucket' }),
      exists: jest.fn().mockResolvedValue(false),
      listAll: jest.fn().mockResolvedValue([]),
    } as unknown as BucketRepository;
    const objectRepo = {
      listByPrefix: jest.fn().mockResolvedValue({ rows: [], truncated: false }),
    } as unknown as ObjectRepository;
    const buckets = { create: jest.fn().mockResolvedValue(undefined) } as unknown as BucketService;
    const objects = {
      // wipeBucketObjects → deleteOne; record that a wipe was attempted.
      deleteOne: jest.fn().mockImplementation(async () => wipeSpy()),
      setTaggingMap: jest.fn().mockResolvedValue(undefined),
    } as unknown as ObjectService;
    const writer = {
      put: jest.fn().mockResolvedValue({ size: 5n }),
    } as unknown as ObjectWriterService;

    return new BackupService(buckets, bucketRepo, objects, objectRepo, writer, config);
  }

  beforeEach(async () => {
    dataDir = join(process.cwd(), 'tmp', 'openbucket-backup-test', randomUUID());
    await fs.mkdir(dataDir, { recursive: true });
    caps = { ...CAPS };
    wipeSpy.mockClear();
  });
  afterEach(async () => {
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  it('TASK-2144: rejects an oversized manifest.json with 400 before parsing', async () => {
    caps.RESTORE_MAX_MANIFEST_BYTES = 64; // 64-byte cap
    const zip = await makeZip({
      'manifest.json': Buffer.from(validManifest()), // well over 64 bytes
      'data/mybucket/f.txt': Buffer.from('hello'),
    });
    const svc = makeService();
    await expect(svc.restoreBucket('mybucket', createReadStream(zip))).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('TASK-2143: rejects a per-entry decompression bomb BEFORE wiping', async () => {
    caps.RESTORE_MAX_ENTRY_BYTES = 8; // tiny per-entry cap
    const zip = await makeZip({
      'manifest.json': Buffer.from(validManifest()),
      'data/mybucket/f.txt': Buffer.alloc(1024, 0x41), // 1 KiB > 8 B cap
    });
    const svc = makeService();
    await expect(svc.restoreBucket('mybucket', createReadStream(zip))).rejects.toBeInstanceOf(
      BadRequestException,
    );
    // The validation pass runs before the destructive wipe.
    expect(wipeSpy).not.toHaveBeenCalled();
  });

  it('TASK-2143: rejects when total decompressed bytes exceed the cap, before wiping', async () => {
    caps.RESTORE_MAX_TOTAL_BYTES = 8;
    const zip = await makeZip({
      'manifest.json': Buffer.from(validManifest()),
      'data/mybucket/f.txt': Buffer.alloc(1024, 0x42),
    });
    const svc = makeService();
    await expect(svc.restoreBucket('mybucket', createReadStream(zip))).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(wipeSpy).not.toHaveBeenCalled();
  });

  it('TASK-2143: rejects an archive with more than RESTORE_MAX_ENTRIES payload entries', async () => {
    caps.RESTORE_MAX_ENTRIES = 1;
    const zip = await makeZip({
      'manifest.json': Buffer.from(validManifest()),
      'data/mybucket/a.txt': Buffer.from('a'),
      'data/mybucket/b.txt': Buffer.from('b'),
    });
    const svc = makeService();
    await expect(svc.restoreBucket('mybucket', createReadStream(zip))).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(wipeSpy).not.toHaveBeenCalled();
  });

  it('restores a within-limits archive successfully', async () => {
    const zip = await makeZip({
      'manifest.json': Buffer.from(validManifest()),
      'data/mybucket/f.txt': Buffer.from('hello'), // 5 bytes, matches manifest size
    });
    const svc = makeService();
    await expect(svc.restoreBucket('mybucket', createReadStream(zip))).resolves.toEqual({
      objectsRestored: 1,
    });
  });
});
