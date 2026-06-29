import { promises as fs, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';

import type { ConfigService } from '@nestjs/config';

import { BlobStore } from './blob-store';
import type { TrashManifest } from './trash';

const stubConfig = (dataDir: string): ConfigService =>
  ({ getOrThrow: () => dataDir }) as unknown as ConfigService;

/**
 * TEST-0211 — verify `BlobStore.deleteBlob` writes a JSON manifest that
 * round-trips into the `TrashManifest` interface (the EPIC-04 trash-purge
 * tick's contract).
 */
describe('TrashManifest round-trip (TEST-0211)', () => {
  let dataDir: string;
  let store: BlobStore;

  beforeEach(async () => {
    dataDir = join(process.cwd(), 'tmp', `openbucket-trash-test-${randomUUID()}`);
    await fs.mkdir(dataDir, { recursive: true });
    store = new BlobStore(stubConfig(dataDir));

    await store.putBlob('b', 'photos/2026/may.jpg', Readable.from([Buffer.from('jpegbytes')]));
    await store.deleteBlob('b', 'photos/2026/may.jpg');
  });

  afterEach(async () => {
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  it('cases 1 & 3: exactly one <uuid>.manifest.json under trash/, entryId matches filename', () => {
    const entries = readdirSync(store.paths.trashDir());
    const manifestNames = entries.filter((e) => e.endsWith('.manifest.json'));
    expect(manifestNames).toHaveLength(1);
    const trashIds = entries.filter((e) => !e.endsWith('.manifest.json'));
    expect(trashIds).toHaveLength(1);
    expect(manifestNames[0]).toBe(`${trashIds[0]}.manifest.json`);
  });

  it('cases 2, 4, 5, 6: JSON parses to a TrashManifest with the right keys + values', async () => {
    const entries = readdirSync(store.paths.trashDir());
    const manifestName = entries.find((e) => e.endsWith('.manifest.json'))!;
    const raw = await fs.readFile(join(store.paths.trashDir(), manifestName), 'utf8');
    const parsed = JSON.parse(raw);

    // case 2: exact key set (no scheduledPurgeAt at delete time).
    expect(Object.keys(parsed).sort()).toEqual(['bucket', 'deletedAt', 'entryId', 'key', 'originalPath']);
    // case 4: raw bucket + raw key (not percent-encoded).
    expect(parsed.bucket).toBe('b');
    expect(parsed.key).toBe('photos/2026/may.jpg');
    // case 5: originalPath is absolute and ends with the encoded blob path.
    expect(parsed.originalPath.replace(/\\/g, '/')).toMatch(/[/\\]blobs[/\\]b[/\\]photos\/2026\/may.jpg$/);
    // case 6: deletedAt round-trips as ISO-8601.
    expect(new Date(parsed.deletedAt).toISOString()).toBe(parsed.deletedAt);
  });

  it('case 7: TypeScript narrowing — parsed JSON satisfies TrashManifest', async () => {
    const entries = readdirSync(store.paths.trashDir());
    const manifestName = entries.find((e) => e.endsWith('.manifest.json'))!;
    const raw = await fs.readFile(join(store.paths.trashDir(), manifestName), 'utf8');
    // Type-only assertion: the compiler accepts this assignment. The
    // surrounding shape checks above cover the runtime guarantee.
    const m: TrashManifest = JSON.parse(raw);
    expect(m.entryId).toBeDefined();
  });
});
