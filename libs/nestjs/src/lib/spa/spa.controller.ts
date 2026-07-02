import { Controller, Get, Inject, Optional, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { readFileSync } from 'node:fs';
import { extname, relative } from 'node:path';

import { OPEN_BUCKET_OPTIONS, type ResolvedOpenBucketOptions } from '../open-bucket-options';
import { Public } from '../common/auth/public.decorator';
import { rewriteBaseHref, safeAssetPath, SPA_ROOT } from './spa-utils';

/**
 * Serves the bundled Angular admin SPA at `<mountPath>/admin`. Hashed assets get a
 * long immutable cache; `index.html` is no-cache and has its `<base href>` rewritten
 * to the mount location at serve time (the build-time href is fixed `/admin/`).
 * Any unmatched `/admin/*` path falls back to the shell (client-side routing).
 *
 * `@Public()` so the admin JWT guard doesn't 401 the UI shell/assets.
 */
@Public()
@Controller('admin')
export class SpaController {
  private readonly mountPath: string;
  private cachedIndex: string | null = null;

  constructor(
    @Inject(SPA_ROOT) private readonly spaRoot: string | null,
    @Optional() @Inject(OPEN_BUCKET_OPTIONS) options?: ResolvedOpenBucketOptions,
  ) {
    this.mountPath = options?.mountPath ?? '';
  }

  @Get(['', '{*path}'])
  serve(@Req() req: Request, @Res() res: Response): void {
    if (!this.spaRoot) {
      res.status(404).type('text/plain').send('OpenBucket admin UI is not bundled in this build.');
      return;
    }

    const prefix = `${this.mountPath}/admin`;
    const rel = req.path.slice(prefix.length).replace(/^\/+/, '');

    // A hashed asset request (has an extension) → serve the file directly.
    if (rel && extname(rel)) {
      const file = safeAssetPath(this.spaRoot, rel);
      if (file) {
        res.setHeader('Cache-Control', cacheControlFor(file));
        // Serve root-relative, NOT as an absolute path. Express 5's `res.sendFile`
        // delegates to `send@1.x`, whose default `dotfiles: 'ignore'` rejects any
        // path containing a dot-prefixed segment. Under pnpm the package's real
        // files live under a `.pnpm/` store directory, so the absolute `file` has a
        // dot segment and every asset 404s (surfacing as a 500). `send` exempts the
        // `root` prefix from the dotfile check, and `safeAssetPath` has already
        // validated `file` stays within `spaRoot`, so the relative remainder is safe.
        res.sendFile(relative(this.spaRoot, file), { root: this.spaRoot });
        return;
      }
    }

    // Everything else → the SPA shell (client-side routing).
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.type('html').send(this.index());
  }

  private index(): string {
    if (this.cachedIndex === null) {
      const file = safeAssetPath(this.spaRoot as string, 'index.html');
      const raw = file ? readFileSync(file, 'utf8') : '';
      this.cachedIndex = rewriteBaseHref(raw, this.mountPath);
    }
    return this.cachedIndex;
  }
}

// Content-hashed bundles are immutable. Angular's esbuild `application` builder
// (v21) names them `name-HASH.ext` with an uppercase-alphanumeric hash — e.g.
// `main-UZ7C7DZ3.js`; older/other tooling uses `name.HASH.ext`. Match either a
// `.` or `-` separator followed by an 8+ char alphanumeric hash, NOT just
// lowercase hex: a hex-only/dot-only pattern silently downgraded every real
// Angular asset to the short cache below.
const HASHED_ASSET =
  /[.-][a-z0-9]{8,}\.(?:js|mjs|css|woff2?|ttf|otf|eot|png|jpe?g|webp|avif|gif|svg|ico)$/i;

function cacheControlFor(file: string): string {
  if (HASHED_ASSET.test(file)) {
    return 'public, max-age=31536000, immutable';
  }
  return 'public, max-age=300';
}
