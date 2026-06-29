---
id: TASK-1551
title: Land the e2e-test sample (`admin-auth.e2e-spec.ts`)
story: STORY-0505
status: done
type: implementation
size: S
---

## Description
Add `apps/backend-e2e/src/admin-auth.e2e-spec.ts` as the canonical e2e template: spins `AppModule` via `Test.createTestingModule`, allocates an ephemeral `DATA_DIR` via `mkdtempSync`, sets `JWT_SECRET` and an argon2id-hashed `ADMIN_PASSWORD_HASH`, then exercises login + refresh + reuse-detection via supertest.

## Files to create / modify
- `apps/backend-e2e/src/admin-auth.e2e-spec.ts` — new

## Implementation notes
- Verbatim sample from white paper §5.20.2:

  ```ts
  // apps/backend-e2e/src/admin-auth.e2e-spec.ts
  import { Test } from '@nestjs/testing';
  import { INestApplication } from '@nestjs/common';
  import * as cookieParser from 'cookie-parser';
  import * as request from 'supertest';
  import * as argon2 from 'argon2';
  import { mkdtempSync } from 'node:fs';
  import { tmpdir } from 'node:os';
  import { join } from 'node:path';

  import { AppModule } from '../../backend/src/app.module';
  import { AdminUserRepository } from '../../backend/src/persistence/repositories/admin-user.repository';

  describe('admin auth (e2e)', () => {
    let app: INestApplication;
    const dataDir = mkdtempSync(join(tmpdir(), 'ob-e2e-'));

    beforeAll(async () => {
      process.env.DATA_DIR = dataDir;
      process.env.JWT_SECRET = 'e2e-secret-e2e-secret-e2e-secret-e2e';
      process.env.ADMIN_PASSWORD_HASH = await argon2.hash('correct horse battery staple', {
        type: argon2.argon2id,
      });

      const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
      app = moduleRef.createNestApplication();
      app.use(cookieParser());
      await app.init();
    });

    afterAll(async () => app.close());

    it('logs in, refreshes, and rejects reuse', async () => {
      const login = await request(app.getHttpServer())
        .post('/api/admin/auth/login')
        .send({ username: 'admin', password: 'correct horse battery staple' })
        .expect(200);

      expect(login.body.accessToken).toBeTruthy();
      const setCookie = login.headers['set-cookie'][0];
      expect(setCookie).toMatch(/ob_refresh=/);
      expect(setCookie).toMatch(/HttpOnly/);
      expect(setCookie).toMatch(/SameSite=Strict/);

      const refresh1 = await request(app.getHttpServer())
        .post('/api/admin/auth/refresh')
        .set('Cookie', setCookie)
        .expect(200);

      // Reusing the original refresh cookie must now fail and revoke the chain.
      await request(app.getHttpServer())
        .post('/api/admin/auth/refresh')
        .set('Cookie', setCookie)
        .expect(401);

      // The fresh cookie from refresh1 is also invalidated by the reuse detection.
      const reusedFresh = refresh1.headers['set-cookie'][0];
      await request(app.getHttpServer())
        .post('/api/admin/auth/refresh')
        .set('Cookie', reusedFresh)
        .expect(401);
    });

    it('protects /me with bearer token', async () => {
      await request(app.getHttpServer())
        .get('/api/admin/auth/me')
        .expect(401);
    });
  });
  ```

- `mkdtempSync(join(tmpdir(), 'ob-e2e-'))` gives a fresh data dir per suite — no fixture cleanup needed if Jest is set to `--workerIdleMemoryLimit` aggressively.
- `JWT_SECRET=e2e-secret-e2e-secret-e2e-secret-e2e` is a fixed 36-char sentinel.

## Acceptance criteria
- [ ] The file exists at the path above with the sample's structure.
- [ ] `nx run backend-e2e:e2e --testPathPattern=admin-auth` runs the suite (passes once admin-auth surface exists per [EPIC-05]).
- [ ] `mkdtempSync` is used (no hard-coded path); `argon2id` is the explicit type.

## Test obligations
- Unit: N/A.
- E2E: this *is* the e2e-test sample; covered by [TEST-0503].
- Conformance: N/A.

## Dependencies
- Blocked by: _none within EPIC-06_

## References
- `docs/WHITEPAPER.md` §5.20.2 (lines 8801–8872)
