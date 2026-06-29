---
id: TASK-1500
title: Write the OpenAPI export script
story: STORY-0500
status: done
type: implementation
size: S
---

## Description
Author `apps/backend/src/openapi-export.ts`, which boots the Nest app, applies `patchNestjsSwagger()`, builds a `DocumentBuilder` config (title, version from `npm_package_version`, bearer auth), creates a Swagger document with `deepScanRoutes: true` and an `operationIdFactory` that returns the bare method name, and writes the JSON to `apps/backend/dist/openapi.json`.

## Files to create / modify
- `apps/backend/src/openapi-export.ts` — new

## Implementation notes
- Verbatim script from white paper §5.16.1:

  ```ts
  // apps/backend/src/openapi-export.ts
  import { NestFactory } from '@nestjs/core';
  import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
  import { writeFileSync, mkdirSync } from 'node:fs';
  import { dirname, resolve } from 'node:path';
  import { patchNestjsSwagger } from 'nestjs-zod';

  import { AppModule } from './app.module';

  async function exportSpec(): Promise<void> {
    const app = await NestFactory.create(AppModule, { logger: false });
    patchNestjsSwagger();

    const config = new DocumentBuilder()
      .setTitle('OpenBucket Admin API')
      .setVersion(process.env.npm_package_version ?? '0.0.0')
      .addServer('/')
      .addBearerAuth()
      .build();

    const document = SwaggerModule.createDocument(app, config, {
      deepScanRoutes: true,
      operationIdFactory: (controllerKey, methodKey) => methodKey,
    });

    const out = resolve(__dirname, '../dist/openapi.json');
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, JSON.stringify(document, null, 2));
    await app.close();
    // eslint-disable-next-line no-console
    console.log(`OpenAPI spec written to ${out}`);
  }

  void exportSpec();
  ```

- Note: `operationIdFactory: (controllerKey, methodKey) => methodKey` keeps generated method names short (`listBuckets`, not `BucketsAdminController_list`).

## Acceptance criteria
- [ ] `tsx apps/backend/src/openapi-export.ts` writes a non-empty `apps/backend/dist/openapi.json`.
- [ ] The JSON contains at least one path from the admin controllers.
- [ ] The script closes the Nest app cleanly (no dangling listeners).

## Test obligations
- Unit: N/A — pure infra; covered by [TEST-0500] at CI level.
- E2E: N/A
- Conformance: N/A

## Dependencies
- Blocked by: _none within EPIC-06; AppModule exists per [EPIC-01]_

## References
- `docs/WHITEPAPER.md` §5.16.1 (lines 8333–8373)
