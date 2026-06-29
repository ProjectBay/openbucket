---
id: TASK-1249
title: Implement attachToken helper
story: STORY-0416
status: done
type: implementation
size: XS
---

## Description
Pure helper used by `authInterceptor` to clone a request with `Authorization: Bearer <token>` and `withCredentials: true`. Returns the original request unchanged when token is null.

## Files to create / modify
- `apps/frontend/src/app/auth/auth.interceptor.ts` — modify (co-located helper)

## Implementation notes
- Verbatim from §5.12 (lines 8056–8062):
  ```ts
  function attachToken(req: HttpRequest<unknown>, token: string | null): HttpRequest<unknown> {
    if (!token) return req;
    return req.clone({
      setHeaders: { Authorization: `Bearer ${token}` },
      withCredentials: true,
    });
  }
  ```

## Acceptance criteria
- [ ] Null token → request unchanged.
- [ ] Non-null token → cloned request carries the header and `withCredentials: true`.

## Test obligations
- Unit: covered by [TEST-0422]
- E2E: N/A
- Conformance: N/A

## Dependencies
- Blocked by: [TASK-1247]

## References
- `docs/WHITEPAPER.md` §5.12 (lines 8056–8062)
