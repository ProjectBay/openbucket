import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AdminModule, HealthModule, OpenBucketCoreModule } from '@openbucket/nestjs';
import { cleanupOpenApiDoc } from 'nestjs-zod';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

/**
 * OpenAPI spec export (WHITEPAPER §5.16.1, adapted to nestjs-zod v5). Boots the
 * Nest app spec-only, derives the OpenAPI document from the admin controllers
 * (deepScanRoutes; nestjs-zod's `createZodDto` DTOs are auto-introspected by
 * @nestjs/swagger in v5, then `cleanupOpenApiDoc` post-processes — this replaces
 * the older `patchNestjsSwagger()` call), writes it to
 * dist/apps/openbucket-backend/openapi.json, and exits. The api-client:generate
 * target feeds this file to openapi-generator-cli.
 *
 * Spec-only: nothing is served. We provide format-valid PLACEHOLDER env so the
 * refuse-to-boot config schema passes without real secrets, so the target is
 * hermetic in CI.
 */
function ensureSpecEnv(): void {
  process.env.NODE_ENV ??= 'production';
  process.env.DATA_DIR ??= mkdtempSync(join(tmpdir(), 'ob-openapi-'));
  process.env.JWT_SECRET ??= 'x'.repeat(40);
  process.env.ROOT_ACCESS_KEY_ID ??= 'AKIA0000000000000000';
  process.env.ROOT_SECRET_ACCESS_KEY ??= 'x'.repeat(40);
  process.env.ADMIN_PASSWORD_HASH ??= '$argon2id$v=19$m=65536,t=3,p=4$abc$def';
}

async function exportSpec(): Promise<void> {
  // Placeholder env BEFORE NestFactory.create (the refuse-to-boot schema runs at
  // module init). Scope the document to the admin surface only (the SPA talks to
  // `/api/admin/*`); the S3 wire-protocol controllers must NOT leak into the
  // generated client (their verb-named handlers collide under the method-name
  // `operationIdFactory` below).
  ensureSpecEnv();
  const app = await NestFactory.create(OpenBucketCoreModule, { logger: false });

  const config = new DocumentBuilder()
    .setTitle('OpenBucket Admin API')
    .setVersion(process.env.npm_package_version ?? '0.0.0')
    .addServer('/')
    .addBearerAuth()
    .build();

  const document = cleanupOpenApiDoc(
    SwaggerModule.createDocument(app, config, {
      include: [AdminModule, HealthModule],
      deepScanRoutes: true,
      operationIdFactory: (_controllerKey, methodKey) => methodKey,
    }),
  );

  const out = resolve(process.cwd(), 'dist/apps/openbucket-backend/openapi.json');
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(document, null, 2));
  await app.close();

  const pathCount = Object.keys(document.paths ?? {}).length;
  // eslint-disable-next-line no-console
  console.log(`OpenAPI spec written to ${out} (${pathCount} paths)`);
}

void exportSpec().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('OpenAPI export failed:', err);
  process.exit(1);
});
