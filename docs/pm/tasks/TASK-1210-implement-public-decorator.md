---
id: TASK-1210
title: Implement @Public() metadata decorator
story: STORY-0403
status: done
type: implementation
size: XS
---

## Description
Metadata-only decorator that `JwtAuthGuard` reads via Reflector to skip authentication on `login` and `refresh`.

## Files to create / modify
- `apps/backend/src/admin/auth/public.decorator.ts` — new

## Implementation notes
- Verbatim from §5.2.4 lines 7071–7077:
  ```ts
  import { SetMetadata } from '@nestjs/common';
  export const IS_PUBLIC_KEY = 'isPublic';
  export const Public = (): MethodDecorator & ClassDecorator =>
    SetMetadata(IS_PUBLIC_KEY, true);
  ```

## Acceptance criteria
- [ ] Exports `IS_PUBLIC_KEY = 'isPublic'` and `Public()` factory.
- [ ] Works at both method and class scope.

## Test obligations
- Unit: covered by [TEST-0408]
- E2E: covered by [TEST-0404]
- Conformance: N/A

## Dependencies
- Blocked by: [TASK-1200]

## References
- `docs/WHITEPAPER.md` §5.2.4 (lines 7069–7077)
