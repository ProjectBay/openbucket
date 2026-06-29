---
id: TASK-0031
title: Implement ConfigModule provider
story: STORY-0011
status: done
type: implementation
size: XS
---

## Description
Author `apps/backend/src/common/config/config.module.ts` providing and exporting `AppConfigService`. This module is imported (aliased as `AppConfigInternalModule`) by `CommonModule` (TASK-0019); the global `@nestjs/config`'s `ConfigModule.forRoot` is registered separately in `AppModule` (TASK-0008).

## Files to create / modify
- `apps/openbucket-backend/src/common/config/config.module.ts` — new

## Implementation notes
- §1.6 line 533: `import { ConfigModule as AppConfigInternalModule } from './config/config.module';`
- §1.6 line 562: re-exported by `CommonModule.exports`.
- Suggested shape:
  ```ts
  import { Module, Global } from '@nestjs/common';
  import { AppConfigService } from './app-config.service';

  @Global()
  @Module({
    providers: [AppConfigService],
    exports: [AppConfigService],
  })
  export class ConfigModule {}
  ```

## Acceptance criteria
- [ ] `AppConfigService` is provided and exported.
- [ ] Module is `@Global()` so consumers don't re-import.
- [ ] `CommonModule` imports this file as `AppConfigInternalModule`.

## Test obligations
- Unit: covered by [TEST-0012]
- E2E: N/A
- Conformance: N/A

## Dependencies
- Blocked by: [TASK-0030]

## References
- `docs/WHITEPAPER.md` §1.6 (lines 533, 561–565); §1.1 (line 65)
