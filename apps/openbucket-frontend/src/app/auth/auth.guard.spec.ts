import { TestBed } from '@angular/core/testing';
import { CanActivateFn, Router, UrlTree } from '@angular/router';

import { authGuard, mustNotRotateGuard, unauthGuard } from './auth.guard';
import { AuthService } from './auth.service';

/**
 * TEST-0420 — route guards (§5.11).
 *
 * NOTE: parked until the frontend jest harness is wired; the guards are
 * build-verified. Covers the true/redirect branch of each guard.
 */
describe('auth guards (TEST-0420)', () => {
  let auth: { isAuthenticated: jest.Mock; mustChangePassword: jest.Mock };
  let createUrlTree: jest.Mock;

  beforeEach(() => {
    auth = { isAuthenticated: jest.fn(), mustChangePassword: jest.fn() };
    createUrlTree = jest.fn((cmds: unknown) => ({ __urlTree: cmds }) as unknown as UrlTree);
    TestBed.configureTestingModule({
      providers: [
        { provide: AuthService, useValue: auth },
        { provide: Router, useValue: { createUrlTree } },
      ],
    });
  });

  const run = (g: CanActivateFn) =>
    TestBed.runInInjectionContext(() => g({} as never, {} as never));

  it('authGuard: true when authenticated, else redirects to /login', () => {
    auth.isAuthenticated.mockReturnValue(true);
    expect(run(authGuard)).toBe(true);

    auth.isAuthenticated.mockReturnValue(false);
    run(authGuard);
    expect(createUrlTree).toHaveBeenCalledWith(['/login']);
  });

  it('unauthGuard: redirects authenticated users to /buckets, else true', () => {
    auth.isAuthenticated.mockReturnValue(true);
    run(unauthGuard);
    expect(createUrlTree).toHaveBeenCalledWith(['/buckets']);

    auth.isAuthenticated.mockReturnValue(false);
    expect(run(unauthGuard)).toBe(true);
  });

  it('mustNotRotateGuard: redirects to /force-rotate when mustChangePassword, else true', () => {
    auth.mustChangePassword.mockReturnValue(true);
    run(mustNotRotateGuard);
    expect(createUrlTree).toHaveBeenCalledWith(['/force-rotate']);

    auth.mustChangePassword.mockReturnValue(false);
    expect(run(mustNotRotateGuard)).toBe(true);
  });
});
