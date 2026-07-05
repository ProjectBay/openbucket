import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';

import { AuthService } from './auth.service';

// §5.11 route guards over the AuthService signals.
export const authGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  return auth.isAuthenticated() ? true : router.createUrlTree(['/login']);
};

export const unauthGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  return auth.isAuthenticated() ? router.createUrlTree(['/buckets']) : true;
};

export const mustNotRotateGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  return auth.mustChangePassword() ? router.createUrlTree(['/force-rotate']) : true;
};

/**
 * Restricts a route to full admins (EPIC-11, STORY-1002). A read-only admin who
 * deep-links to `/users` is redirected home. The server-side RolesGuard is still
 * authoritative — this is UX + defense in depth.
 */
export const fullAdminGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  return auth.isFullAdmin() ? true : router.createUrlTree(['/']);
};
