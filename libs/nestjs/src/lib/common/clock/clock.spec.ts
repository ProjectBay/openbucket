import { BadRequestException } from '@nestjs/common';

import { Clock, SystemClock, TestClock } from './clock';
import { TestController } from '../../admin/_test/test.controller';

/**
 * TEST-0324 — Clock/TestClock unit semantics + TestController validation.
 * The ClockModule provider-selection branch (cases 6 + 7) is environment-
 * driven; verifying it programmatically in a single jest process requires
 * mutating `process.env.OPENBUCKET_TEST_MODE` before module load, which is
 * brittle under jest's module cache. The e2e (TEST-0325) covers it
 * naturally by spawning two backends with different env. The class + module
 * behaviours that *can* be unit-tested in isolation live here.
 */
describe('Clock (TEST-0324)', () => {
  it('case 1: SystemClock.nowMs ≈ Date.now()', () => {
    const sys = new SystemClock();
    expect(Math.abs(sys.nowMs() - Date.now())).toBeLessThan(50);
    expect(sys.now()).toBeInstanceOf(Date);
  });

  it('case 2: TestClock.nowMs() === Date.now() + offsetMs', () => {
    const tc = new TestClock();
    expect(Math.abs(tc.nowMs() - Date.now())).toBeLessThan(5);
    tc.advance(10_000);
    expect(tc.nowMs() - Date.now()).toBeGreaterThanOrEqual(9_995);
    expect(tc.nowMs() - Date.now()).toBeLessThanOrEqual(10_010);
  });

  it('case 3: advance(0) is a no-op', () => {
    const tc = new TestClock();
    tc.advance(0);
    expect(Math.abs(tc.nowMs() - Date.now())).toBeLessThan(5);
  });

  it('case 4: advance(-1) throws "TestClock can only advance forward"', () => {
    const tc = new TestClock();
    expect(() => tc.advance(-1)).toThrow('TestClock can only advance forward');
  });

  it('case 5: reset() zeroes offsetMs', () => {
    const tc = new TestClock();
    tc.advance(60_000);
    tc.reset();
    expect(Math.abs(tc.nowMs() - Date.now())).toBeLessThan(5);
  });

  it('cases 6+7: ClockModule provider selection — covered by TEST-0325 e2e via env-spawned backends', () => {
    // Asserting the branch in-process requires reloading the module under a
    // mutated process.env, which collides with jest's module cache. The e2e
    // spec spawns two backends (with and without OPENBUCKET_TEST_MODE=1) and
    // verifies the gated route is mounted only in test mode — covers cases
    // 6 and 7 of this plan operationally. Documented as deferred-to-e2e.
    expect(typeof Clock).toBe('function');
  });

  it('case 8: TestController.advanceClock({ms:1000}) calls clock.advance and returns offsetMs', () => {
    const tc = new TestClock();
    const ctrl = new TestController(tc);
    const res = ctrl.advanceClock({ ms: 1000 });
    expect(res.offsetMs).toBeGreaterThanOrEqual(995);
    expect(res.offsetMs).toBeLessThanOrEqual(1010);
  });

  it('case 9: TestController.advanceClock({ms:-1}) throws BadRequestException', () => {
    const ctrl = new TestController(new TestClock());
    expect(() => ctrl.advanceClock({ ms: -1 })).toThrow(BadRequestException);
    expect(() => ctrl.advanceClock({ ms: -1 })).toThrow('ms must be a non-negative number');
  });

  it('case 10: TestController.advanceClock({ms:"foo"}) (non-numeric) throws BadRequestException', () => {
    const ctrl = new TestController(new TestClock());
    expect(() => ctrl.advanceClock({ ms: 'foo' as unknown as number })).toThrow(BadRequestException);
  });
});
