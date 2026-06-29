import { existsSync } from 'node:fs';
import { join, normalize, resolve, sep } from 'node:path';

/** DI token for the resolved SPA asset directory (or null when not bundled). */
export const SPA_ROOT = Symbol('SPA_ROOT');

/**
 * Rewrite the Angular `<base href="...">` (built as `/admin/`) to the mounted
 * location `<mountPath>/admin/`, so asset + router URLs resolve under the prefix.
 * `mountPath` is '' for the standalone (→ `/admin/`).
 */
export function rewriteBaseHref(html: string, mountPath: string): string {
  return html.replace(/<base\s+href="[^"]*"\s*\/?>/i, `<base href="${mountPath}/admin/">`);
}

/**
 * Find the bundled SPA directory across the contexts the lib runs in:
 * - published package: `<dist>/libs/nestjs/assets/spa` (relative to this file), and
 * - dev / monorepo: the frontend build output.
 * Returns the first candidate containing `index.html`, else null (UI not bundled).
 */
export function resolveSpaRoot(fromDir: string = __dirname): string | null {
  const candidates = [
    join(fromDir, '..', '..', 'assets', 'spa'),
    join(fromDir, '..', '..', '..', 'assets', 'spa'),
    // dev / monorepo: the Angular build emits the SPA under `browser/`.
    join(process.cwd(), 'dist', 'apps', 'openbucket-frontend', 'browser'),
    join(process.cwd(), 'dist', 'libs', 'nestjs', 'assets', 'spa'),
  ];
  return candidates.find((c) => existsSync(join(c, 'index.html'))) ?? null;
}

/**
 * Resolve a request-relative asset path INSIDE the SPA root, rejecting traversal.
 * Returns the absolute path if it stays within `root` and exists, else null.
 */
export function safeAssetPath(root: string, relative: string): string | null {
  if (!relative) return null;
  const abs = resolve(root, normalize(relative).replace(/^(\.\.[/\\])+/, ''));
  const rootResolved = resolve(root);
  if (abs !== rootResolved && !abs.startsWith(rootResolved + sep)) return null;
  return existsSync(abs) ? abs : null;
}
