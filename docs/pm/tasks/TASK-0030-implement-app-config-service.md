---
id: TASK-0030
title: Implement AppConfigService typed wrapper
story: STORY-0011
status: done
type: implementation
size: S
---

## Description
Author `apps/backend/src/common/config/app-config.service.ts` per §1.7. The service is a thin `@Injectable()` wrapper around `ConfigService<Env, true>` exposing 17 strongly-typed getters covering every key from `EnvSchema`.

## Files to create / modify
- `apps/openbucket-backend/src/common/config/app-config.service.ts` — new

## Implementation notes
- Quote §1.7 (lines 786–813) verbatim:
  ```ts
  @Injectable()
  export class AppConfigService {
    constructor(private readonly raw: ConfigService<Env, true>) {}

    get nodeEnv(): Env['NODE_ENV']        { return this.raw.get('NODE_ENV', { infer: true }); }
    get port(): number                    { return this.raw.get('PORT', { infer: true }); }
    get logLevel(): Env['LOG_LEVEL']      { return this.raw.get('LOG_LEVEL', { infer: true }); }
    get dataDir(): string                 { return this.raw.get('DATA_DIR', { infer: true }); }
    get jwtSecret(): string               { return this.raw.get('JWT_SECRET', { infer: true }); }
    get jwtAccessTtl(): number            { return this.raw.get('JWT_ACCESS_TTL_SECONDS', { infer: true }); }
    get jwtRefreshTtl(): number           { return this.raw.get('JWT_REFRESH_TTL_SECONDS', { infer: true }); }
    get adminUsername(): string           { return this.raw.get('ADMIN_USERNAME', { infer: true }); }
    get adminPasswordHash(): string       { return this.raw.get('ADMIN_PASSWORD_HASH', { infer: true }); }
    get rootAccessKeyId(): string         { return this.raw.get('ROOT_ACCESS_KEY_ID', { infer: true }); }
    get rootSecretAccessKey(): string     { return this.raw.get('ROOT_SECRET_ACCESS_KEY', { infer: true }); }
    get endpoint(): string | undefined    { return this.raw.get('OPENBUCKET_ENDPOINT', { infer: true }); }
    get region(): string                  { return this.raw.get('OPENBUCKET_REGION', { infer: true }); }
    get maxObjectSizeMb(): number         { return this.raw.get('MAX_OBJECT_SIZE_MB', { infer: true }); }
    get maxMultipartParts(): number       { return this.raw.get('MAX_MULTIPART_PARTS', { infer: true }); }
    get multipartTtlHours(): number       { return this.raw.get('MULTIPART_TTL_HOURS', { infer: true }); }
    get shutdownDrainMs(): number         { return this.raw.get('SHUTDOWN_DRAIN_MS', { infer: true }); }
  }
  ```
- All 17 getters must be present — downstream Stories (STORY-0007 endpoint, STORY-0015 shutdownDrainMs, EPIC-02 region/endpoint/root keys, EPIC-03 dataDir, EPIC-04 multipart limits, EPIC-05 jwtSecret/admin*) depend on these names.

## Acceptance criteria
- [ ] All 17 getters present with exact names and return types from §1.7.
- [ ] `endpoint` getter returns `string | undefined`.
- [ ] All `raw.get(...)` calls pass `{ infer: true }`.

## Test obligations
- Unit: covered by [TEST-0012]
- E2E: N/A
- Conformance: N/A

## Dependencies
- Blocked by: [TASK-0028]

## References
- `docs/WHITEPAPER.md` §1.7 (lines 783–813)
