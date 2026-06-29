---
id: TASK-0032
title: Implement HealthController with health endpoint
story: STORY-0012
status: done
type: implementation
size: XS
---

## Description
Create `apps/backend/src/admin/health/health.controller.ts` containing `@Controller('api/admin')` with a `@Get('health')` route returning `{ status: 'ok', uptime: Math.floor(process.uptime()) }` at HTTP 200. Mark `@Public()` (decorator owned by EPIC-05) so the future admin JWT guard skips it.

## Files to create / modify
- `apps/openbucket-backend/src/admin/health/health.controller.ts` — new

## Implementation notes
- Quote §1.8 (lines 838–844):
  ```ts
  /** Liveness — the process is alive and the event loop responds. */
  @Public()
  @Get('health')
  @HttpCode(200)
  health(): { status: 'ok'; uptime: number } {
    return { status: 'ok', uptime: Math.floor(process.uptime()) };
  }
  ```
- `@Public()` is imported from `'../../common/auth/public.decorator'` per §1.8 line 825 — EPIC-05 owns the decorator. Until then a stub `export const Public = () => () => {};` may be needed, but that stub belongs to EPIC-05's preparation Tasks, not here.

## Acceptance criteria
- [ ] `GET /api/admin/health` returns 200 with `{ status: 'ok', uptime: <int> }`.
- [ ] `uptime` is computed via `Math.floor(process.uptime())`.
- [ ] Route is decorated `@Public()`.

## Test obligations
- Unit: N/A — behaviour is observable only over HTTP
- E2E: covered by [TEST-0013]
- Conformance: N/A

## Dependencies
- Blocked by: [TASK-0001]

## References
- `docs/WHITEPAPER.md` §1.8 (lines 822–844)
