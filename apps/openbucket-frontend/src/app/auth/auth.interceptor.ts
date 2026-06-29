import { HttpEvent, HttpInterceptorFn, HttpRequest } from '@angular/common/http';
import { inject } from '@angular/core';
import { Observable, catchError, from, switchMap, throwError } from 'rxjs';

import { AuthService } from './auth.service';

/** The login/refresh endpoints don't get a bearer — they ride the cookie. */
const AUTH_PATHS = ['/api/admin/auth/login', '/api/admin/auth/refresh'];

/**
 * Attaches the in-memory bearer to every request and, on a 401, refreshes ONCE
 * and retries the original request. A second 401 logs out and rethrows (§5.12).
 */
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthService);

  if (AUTH_PATHS.some((p) => req.url.startsWith(p))) {
    return next(req.clone({ withCredentials: true }));
  }

  return next(attachToken(req, auth.getAccessToken())).pipe(
    catchError((err) => {
      if (err?.status !== 401) return throwError(() => err);

      return from(auth.refresh()).pipe(
        switchMap((ok): Observable<HttpEvent<unknown>> => {
          if (!ok) {
            void auth.logout(); // fire-and-forget; routes to /login
            return throwError(() => err);
          }
          return next(attachToken(req, auth.getAccessToken()));
        }),
      );
    }),
  );
};

function attachToken(req: HttpRequest<unknown>, token: string | null): HttpRequest<unknown> {
  if (!token) return req;
  return req.clone({
    setHeaders: { Authorization: `Bearer ${token}` },
    withCredentials: true,
  });
}
