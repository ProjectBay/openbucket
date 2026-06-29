---
id: TASK-1554
title: Document the `mkdtempSync` data-dir and argon2 password-hash convention for e2e
story: STORY-0505
status: done
type: docs
size: XS
---

## Description
Add a top-of-file docblock to `admin-auth.e2e-spec.ts` capturing the e2e fixture convention: ephemeral `DATA_DIR` via `mkdtempSync(join(tmpdir(), 'ob-e2e-'))`, fixed `JWT_SECRET` sentinel, and `ADMIN_PASSWORD_HASH` derived at suite-setup time via `argon2.hash(..., { type: argon2.argon2id })`. Other Epics' e2e Test Plans copy this fixture block.

## Files to create / modify
- `apps/backend-e2e/src/admin-auth.e2e-spec.ts` — modify (add docblock; file body lands via [TASK-1551])

## Implementation notes
- The convention is realized by these load-bearing lines (verbatim from §5.20.2):

  ```ts
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
  ```

- The docblock should call out: (a) `mkdtempSync` for isolation per suite, (b) `argon2id` is the only acceptable hash type, (c) `cookieParser()` is required for refresh-cookie handling.

## Acceptance criteria
- [ ] `admin-auth.e2e-spec.ts` carries a docblock summarizing the three points above.
- [ ] The docblock quotes the `mkdtempSync` and `argon2.hash(..., { type: argon2.argon2id })` lines.

## Test obligations
- Unit: N/A — docs.
- E2E: N/A.
- Conformance: N/A.

## Dependencies
- Blocked by: [TASK-1551]

## References
- `docs/WHITEPAPER.md` §5.20.2 (lines 8817–8832)
