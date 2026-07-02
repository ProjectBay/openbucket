import { HttpInterceptorFn } from '@angular/common/http';

/**
 * The SPA's mount prefix, derived from the document `<base href>`.
 *
 * The backend rewrites the base to `<mountPath>/admin/` at serve time (e.g.
 * `/storage/admin/` when embedded under `mountPath: '/storage'`, or `/admin/`
 * for the standalone app). Stripping the trailing `admin/` yields the mount
 * prefix — `/storage` when mounted, `''` for the standalone root.
 *
 * Every API/S3 URL the SPA builds is otherwise root-absolute (`/api/admin/...`,
 * `/<bucket>/<key>`), which only works at the root. Prefixing with this value
 * makes the console work under any mount.
 */
export function resolveMountPrefix(doc: Document = document): string {
  const href = doc.querySelector('base')?.getAttribute('href') ?? '/';
  // "<mountPath>/admin/" → "<mountPath>"; "/admin/" → "".
  return href.replace(/admin\/?$/, '').replace(/\/$/, '');
}

/**
 * Prefix root-absolute API calls (`/api/...`) with the mount path so the admin
 * console's HTTP traffic resolves under `<mountPath>` — both the generated
 * api-client (`basePath: ''`) and the hand-written `HttpClient` calls emit
 * `/api/admin/...`; this rewrites them to `<mountPath>/api/admin/...`. No-op for
 * the standalone (mount `''`).
 *
 * MUST run AFTER {@link authInterceptor}, whose auth-path check keys on the
 * un-prefixed `/api/admin/auth/*` URL (see app.config `withInterceptors` order).
 */
export const mountPrefixInterceptor: HttpInterceptorFn = (req, next) => {
  const prefix = resolveMountPrefix();
  if (prefix && req.url.startsWith('/api/')) {
    return next(req.clone({ url: prefix + req.url }));
  }
  return next(req);
};
