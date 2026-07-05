import { ExecutionContext, NotFoundException, UnauthorizedException } from '@nestjs/common';

import type { AppConfigService } from '../config/app-config.service';
import { MetricsAuthGuard } from './metrics-auth.guard';

/** Build a minimal ExecutionContext exposing `req.headers.authorization`. */
function ctxWith(authorization?: string): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ headers: authorization ? { authorization } : {} }),
    }),
  } as unknown as ExecutionContext;
}

function guardFor(mode: 'off' | 'public' | 'token', token?: string): MetricsAuthGuard {
  const config = { metricsMode: mode, metricsToken: token } as unknown as AppConfigService;
  return new MetricsAuthGuard(config);
}

/** TEST-1202 — MetricsAuthGuard mode matrix + timingSafeEqual length-safety. */
describe('MetricsAuthGuard (TEST-1202)', () => {
  it('mode=off denies with 404 (never leaks a body)', () => {
    expect(() => guardFor('off').canActivate(ctxWith('Bearer whatever'))).toThrow(NotFoundException);
  });

  it('mode=public allows any request', () => {
    expect(guardFor('public').canActivate(ctxWith())).toBe(true);
    expect(guardFor('public').canActivate(ctxWith('Bearer x'))).toBe(true);
  });

  describe('mode=token', () => {
    const TOKEN = 'a-strong-metrics-token-value-1234567890';

    it('allows the correct bearer token', () => {
      expect(guardFor('token', TOKEN).canActivate(ctxWith(`Bearer ${TOKEN}`))).toBe(true);
    });

    it('rejects a missing Authorization header', () => {
      expect(() => guardFor('token', TOKEN).canActivate(ctxWith())).toThrow(UnauthorizedException);
    });

    it('rejects a non-bearer scheme', () => {
      expect(() => guardFor('token', TOKEN).canActivate(ctxWith(`Basic ${TOKEN}`))).toThrow(
        UnauthorizedException,
      );
    });

    it('rejects a wrong token of equal length', () => {
      const wrong = 'X'.repeat(TOKEN.length);
      expect(() => guardFor('token', TOKEN).canActivate(ctxWith(`Bearer ${wrong}`))).toThrow(
        UnauthorizedException,
      );
    });

    it('rejects (does NOT throw a crypto error) on an unequal-length token', () => {
      // timingSafeEqual throws on length mismatch — the length guard must turn
      // that into a clean 401, not an unhandled crypto RangeError.
      const short = 'Bearer short';
      let thrown: unknown;
      try {
        guardFor('token', TOKEN).canActivate(ctxWith(short));
      } catch (e) {
        thrown = e;
      }
      expect(thrown).toBeInstanceOf(UnauthorizedException);
    });

    it('rejects when no token is configured (defensive)', () => {
      expect(() => guardFor('token', undefined).canActivate(ctxWith('Bearer x'))).toThrow(
        UnauthorizedException,
      );
    });
  });
});
