import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * TEST-0314 — HTTP server timeout calibration (§4.5).
 *
 * main.ts self-executes bootstrap(), so the timeout values are asserted by
 * source inspection here; their runtime effect was confirmed by the live boot
 * smoke test and is re-checked by the boundary e2e suite.
 */
describe('main.ts server timeouts (§4.5)', () => {
  const src = readFileSync(join(__dirname, '..', 'main.ts'), 'utf8');

  it('case 1: requestTimeout = 0', () => {
    expect(src).toMatch(/httpServer\.requestTimeout\s*=\s*0\b/);
  });

  it('case 2: headersTimeout = 60_000', () => {
    expect(src).toMatch(/httpServer\.headersTimeout\s*=\s*60_000\b/);
  });

  it('case 3: keepAliveTimeout = 75_000', () => {
    expect(src).toMatch(/httpServer\.keepAliveTimeout\s*=\s*75_000\b/);
  });

  it('case 4: timeout = 0 (no socket inactivity timeout)', () => {
    expect(src).toMatch(/httpServer\.timeout\s*=\s*0\b/);
  });

  it('case 5: references the §4.5 calibration rationale', () => {
    expect(src).toContain('§4.5');
  });
});
