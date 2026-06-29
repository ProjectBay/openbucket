---
id: TASK-1248
title: Implement authInterceptor with single-retry refresh
story: STORY-0416
status: done
type: implementation
size: M
---

## Description
HTTP interceptor that attaches the bearer to every non-auth request and, on a 401, attempts `auth.refresh()` exactly once, then retries the original request or calls `auth.logout()`.

## Files to create / modify
- `apps/frontend/src/app/auth/auth.interceptor.ts` — new

## Implementation notes
- Verbatim from §5.12 (lines 8019–8062):
  ```ts
  const AUTH_PATHS = ['/api/admin/auth/login', '/api/admin/auth/refresh'];

  export const authInterceptor: HttpInterceptorFn = (req, next) => {
    const auth = inject(AuthService);

    // Don't attach a bearer to the login/refresh calls themselves.
    if (AUTH_PATHS.some((p) => req.url.startsWith(p))) {
      return next(req.clone({ withCredentials: true }));
    }

    const withAuth = attachToken(req, auth.getAccessToken());

    return next(withAuth).pipe(
      catchError((err) => {
        if (err?.status !== 401) return throwError(() => err);

        return from(auth.refresh()).pipe(
          switchMap((ok): Observable<HttpEvent<unknown>> => {
            if (!ok) {
              auth.logout();
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
  ```
- The refresh cookie is scoped to `/api/admin/auth`; non-auth endpoints don't receive it, so there is no CSRF surface for state-changing endpoints.

## Acceptance criteria
- [ ] Requests to `/api/admin/auth/login` and `/api/admin/auth/refresh` skip bearer attachment but still set `withCredentials: true`.
- [ ] Other requests get `Authorization: Bearer <accessToken>` and `withCredentials: true`.
- [ ] On 401, exactly one `auth.refresh()` call is made before retry.
- [ ] If refresh returns false → `auth.logout()` is called and the original error is rethrown.
- [ ] Second 401 from the retried request also triggers logout (no infinite loop — refresh is only attempted once per request).

## Test obligations
- Unit: covered by [TEST-0422]
- E2E: N/A
- Conformance: N/A

## Dependencies
- Blocked by: [TASK-1247], [TASK-1249]

## References
- `docs/WHITEPAPER.md` §5.12 (lines 8017–8065)
