import { existsSync, realpathSync } from 'node:fs';
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
 *
 * Defence-in-depth (TASK-2161, CWE-59): after the lexical containment check, the
 * real (symlink-resolved) target is re-verified against the real SPA root, so a
 * symlink *inside* the SPA root that points *outside* it cannot be served. The
 * root itself is realpath-resolved too, to avoid a false negative when the SPA
 * root is reached through a symlink.
 */
export function safeAssetPath(root: string, relative: string): string | null {
  if (!relative) return null;
  const abs = resolve(root, normalize(relative).replace(/^(\.\.[/\\])+/, ''));
  const rootResolved = resolve(root);
  if (abs !== rootResolved && !abs.startsWith(rootResolved + sep)) return null;
  if (!existsSync(abs)) return null;

  // Re-assert containment against the symlink-resolved (real) paths. Express's
  // `send` follows symlinks without re-checking the target against `root`, so a
  // link escaping the SPA dir would otherwise be served. Both sides are resolved
  // (the root too) to avoid a false negative when the SPA root itself is reached
  // through a symlink (e.g. the pnpm store, or `/tmp` → `/private/tmp` on macOS).
  try {
    const real = realpathSync.native(abs);
    const rootReal = realpathSync.native(rootResolved);
    if (real !== rootReal && !real.startsWith(rootReal + sep)) return null;
  } catch {
    // Broken/dangling symlink or a race removing the file → treat as not found.
    return null;
  }
  // Return the lexical path (not `real`): the caller serves it via
  // `res.sendFile(relative(root, abs), { root })`, which must stay root-relative
  // even when `root` itself sits behind a symlink. `send` re-follows the link to
  // the target we just validated is inside the SPA root.
  return abs;
}
