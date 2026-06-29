import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * TEST-0315 — UV_THREADPOOL_SIZE default + import ordering.
 */
describe('uv-threadpool side-effect module', () => {
  const ORIGINAL = process.env.UV_THREADPOOL_SIZE;

  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.UV_THREADPOOL_SIZE;
    else process.env.UV_THREADPOOL_SIZE = ORIGINAL;
    jest.resetModules();
  });

  it('defaults to 16 when unset', async () => {
    delete process.env.UV_THREADPOOL_SIZE;
    jest.resetModules();
    await import('./uv-threadpool');
    expect(process.env.UV_THREADPOOL_SIZE).toBe('16');
  });

  it('preserves an explicit value (??= does not override)', async () => {
    process.env.UV_THREADPOOL_SIZE = '8';
    jest.resetModules();
    await import('./uv-threadpool');
    expect(process.env.UV_THREADPOOL_SIZE).toBe('8');
  });

  it('is the first import in main.ts (runs before hoisted deps)', () => {
    const src = readFileSync(join(__dirname, '..', 'main.ts'), 'utf8');
    const firstImport = src.split('\n').find((l) => l.trimStart().startsWith('import '));
    expect(firstImport).toContain('./bootstrap/uv-threadpool');
  });
});
