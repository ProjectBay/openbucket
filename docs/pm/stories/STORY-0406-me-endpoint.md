---
id: STORY-0406
title: Implement GET /api/admin/auth/me
epic: EPIC-05
status: done
size: XS
risk: low
---

## User story
As an admin user, I want to GET `/api/admin/auth/me` and receive my identity and `mustChangePassword` flag, so that the SPA can populate the topbar and decide whether to force the password-rotation screen.

## Description
Implement `AuthController.me` per §5.2.4. `@Get('me')`. Reads decoded JWT payload from `req.user`; returns `MeResponseDto = { id: payload.sub, username: payload.username, mustChangePassword: payload.mustChangePassword }`. JWT required (no `@Public()`). Define `MeResponseDto` as a nestjs-zod DTO.

## Acceptance criteria
- [x] Route is `GET /api/admin/auth/me`, requires JWT.
- [x] Returns 200 with body `{ id: string, username: string, mustChangePassword: boolean }`.
- [x] Missing/invalid bearer → 401 (handled by `JwtAuthGuard`).
- [x] Body fields are sourced from JWT claims, not a database read.

## Tasks
- [TASK-1213] Implement `MeResponseDto`
- [TASK-1214] Implement `AuthController.me`

## Test plan
- [TEST-0407] Me endpoint e2e

## Dependencies
- Blocks: _none_
- Blocked by: [STORY-0403], [STORY-0407]

## References
- `docs/WHITEPAPER.md` §5.2.4 (lines 7047–7055)
