import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * TEST-0314 / TASK-2111 — HTTP server timeout calibration (§4.5, CWE-400).
 *
 * main.ts self-executes bootstrap(), so the timeout values are asserted by
 * source inspection here; their runtime effect was confirmed by the live boot
 * smoke test and is re-checked by the boundary e2e suite. The blanket `0`/`0`
 * of STORY-0309 is superseded: per-request and socket-inactivity timeouts are
 * finite again to close the slow-body slowloris/RUDY vector.
 */
describe('main.ts server timeouts (§4.5, TASK-2111)', () => {
  const src = readFileSync(join(__dirname, '..', 'main.ts'), 'utf8');

  it('case 1: requestTimeout is finite and non-zero', () => {
    const m = src.match(/httpServer\.requestTimeout\s*=\s*([\d_]+)\b/);
    expect(m).not.toBeNull();
    const value = Number(m![1].replace(/_/g, ''));
    expect(value).toBeGreaterThan(0);
  });

  it('case 2: headersTimeout = 60_000', () => {
    expect(src).toMatch(/httpServer\.headersTimeout\s*=\s*60_000\b/);
  });

  it('case 3: keepAliveTimeout = 75_000', () => {
    expect(src).toMatch(/httpServer\.keepAliveTimeout\s*=\s*75_000\b/);
  });

  it('case 4: timeout is finite and non-zero (socket inactivity bounded)', () => {
    const m = src.match(/httpServer\.timeout\s*=\s*([\d_]+)\b/);
    expect(m).not.toBeNull();
    const value = Number(m![1].replace(/_/g, ''));
    expect(value).toBeGreaterThan(0);
  });

  it('case 5: maxConnections ceiling is set', () => {
    const m = src.match(/httpServer\.maxConnections\s*=\s*([\d_]+)\b/);
    expect(m).not.toBeNull();
    expect(Number(m![1].replace(/_/g, ''))).toBeGreaterThan(0);
  });

  it('case 6: references the §4.5 calibration rationale', () => {
    expect(src).toContain('§4.5');
  });
});
