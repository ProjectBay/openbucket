import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

import { ConfigService } from '@nestjs/config';

import type { AppConfigService } from '../config/app-config.service';
import { Clock } from '../clock/clock';
import { DerivativeCacheService } from '../../storage/derivative-cache.service';
import { DerivativeCacheGcRunner } from './derivative-cache-gc.runner';

/**
 * TEST-0800 — DerivativeCacheGcRunner. Drives a real temp derivative store:
 * LRU eviction to the 0.9 low-water mark, no-op when under the cap, the
 * unbounded (=0) short-circuit, and ENOENT tolerance for an absent store dir.
 */
describe('DerivativeCacheGcRunner (TASK-2404)', () => {
  let dataDir: string;
  let cache: DerivativeCacheService;
  const clock = { nowMs: () => Date.now() } as unknown as Clock;

  const runnerWith = (maxBytes: number): DerivativeCacheGcRunner =>
    new DerivativeCacheGcRunner(cache, { derivativeCacheMaxBytes: maxBytes } as unknown as AppConfigService, clock);

  /** Write a derivative of `size` bytes with an explicit mtime (for LRU order). */
  async function writeEntry(hash: string, size: number, mtimeMs: number): Promise<string> {
    await cache.put(hash, 'webp', Buffer.alloc(size, 1));
    const path = cache.paths.derivativePath(hash, 'webp');
    const t = new Date(mtimeMs);
    await fs.utimes(path, t, t);
    return path;
  }

  const hex = (n: number): string => n.toString(16).padStart(64, '0');

  beforeEach(async () => {
    dataDir = join(process.cwd(), 'tmp', `ob-gc-${randomUUID()}`);
    await fs.mkdir(dataDir, { recursive: true });
    cache = new DerivativeCacheService({ getOrThrow: () => dataDir } as unknown as ConfigService);
  });

  afterEach(async () => {
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  async function totalSize(): Promise<number> {
    let total = 0;
    for await (const e of cache.listEntries()) total += e.size;
    return total;
  }

  it('case 1: evicts oldest-mtime entries until the store is <= 0.9 * max', async () => {
    const base = Date.parse('2026-06-01T00:00:00.000Z');
    // 10 entries of 100 bytes each = 1000 total; increasing mtime with index.
    const paths: string[] = [];
    for (let i = 0; i < 10; i++) {
      paths.push(await writeEntry(hex(i), 100, base + i * 1000));
    }
    expect(await totalSize()).toBe(1000);

    // cap 500 → target 450. Must drop to <= 450, evicting the 6 oldest (→ 400).
    await runnerWith(500).run();

    const total = await totalSize();
    expect(total).toBeLessThanOrEqual(450);
    // The oldest (index 0..) are gone; the newest survive.
    await expect(fs.stat(paths[0])).rejects.toThrow();
    await expect(fs.stat(paths[9])).resolves.toBeDefined();
  });

  it('case 2: evicts nothing when total is under the cap', async () => {
    await writeEntry(hex(1), 100, Date.now());
    await writeEntry(hex(2), 100, Date.now());
    await runnerWith(10_000).run();
    expect(await totalSize()).toBe(200);
  });

  it('case 3: DERIVATIVE_CACHE_MAX_BYTES=0 short-circuits (no eviction)', async () => {
    await writeEntry(hex(1), 1000, Date.now());
    await runnerWith(0).run();
    expect(await totalSize()).toBe(1000);
  });

  it('case 4: a missing derivatives dir does not throw', async () => {
    await expect(runnerWith(500).run()).resolves.toBeUndefined();
  });

  it('case 5: a single entry larger than the cap is still evicted (loop terminates)', async () => {
    await writeEntry(hex(1), 1000, Date.now());
    await runnerWith(100).run();
    expect(await totalSize()).toBe(0);
  });

  it('exposes the ScheduledTask contract', () => {
    const runner = runnerWith(500);
    expect(runner.name).toBe('derivative-cache-gc');
    expect(runner.intervalMs).toBe(10 * 60_000);
  });
});
