#!/usr/bin/env node
/*
 * Bundle the built admin SPA into the @openbucket/nestjs package output
 * (packaging plan, phase 6). The Angular build emits the SPA to
 * `dist/apps/openbucket-frontend/browser`; this copies it to
 * `dist/libs/nestjs/assets/spa` — the location `resolveSpaRoot()` looks for
 * (`assets/spa/index.html`) when the published library serves the console.
 *
 * Why a script and not the `@nx/js:tsc` `assets` glob: that executor resolves
 * an asset `input` relative to the PROJECT root (libs/nestjs), so it cannot reach
 * the frontend's build output, which lives in a SIBLING project's dist
 * (dist/apps/openbucket-frontend/browser). An explicit fs copy is the reliable
 * cross-platform mechanism.
 *
 * Prereqs (note the opposite Node requirements): build the frontend on Node 23
 * (`nx build openbucket-frontend`) and the lib on Node 20 (`nx build nestjs`)
 * first. Driven by the `bundle-spa` target so `nx bundle-spa nestjs` does both
 * the lib tsc build and this copy.
 *
 * Run: node scripts/copy-spa.mjs
 */
import { cpSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'dist', 'apps', 'openbucket-frontend', 'browser');
const dest = join(root, 'dist', 'libs', 'nestjs', 'assets', 'spa');

if (!existsSync(join(src, 'index.html'))) {
  console.error(
    `[copy-spa] No SPA at ${src} (index.html missing).\n` +
      `[copy-spa] Build the frontend first: nx build openbucket-frontend (Node 23).`,
  );
  process.exit(1);
}

rmSync(dest, { recursive: true, force: true });
cpSync(src, dest, { recursive: true });

if (!existsSync(join(dest, 'index.html'))) {
  console.error(`[copy-spa] Copy completed but ${join(dest, 'index.html')} is missing.`);
  process.exit(1);
}

console.log(`[copy-spa] Copied ${readdirSync(dest).length} entries → ${dest}`);
