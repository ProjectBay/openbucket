import { Injectable } from '@nestjs/common';

/**
 * Single point of contact for "what time is it?" across the backend, so that
 * conformance tests can fast-forward without sleeping (lifecycle sweeps,
 * multipart-cleanup grace windows, refresh-token expiry — all read `Clock`).
 * See WHITEPAPER §4.11.
 */
export abstract class Clock {
  abstract nowMs(): number;
  now(): Date {
    return new Date(this.nowMs());
  }
}

@Injectable()
export class SystemClock extends Clock {
  nowMs(): number {
    return Date.now();
  }
}

@Injectable()
export class TestClock extends Clock {
  private offsetMs = 0;

  nowMs(): number {
    return Date.now() + this.offsetMs;
  }

  /** Forward-only fast-forward; negative deltas are a programmer error. */
  advance(ms: number): void {
    if (ms < 0) throw new Error('TestClock can only advance forward');
    this.offsetMs += ms;
  }

  reset(): void {
    this.offsetMs = 0;
  }
}
