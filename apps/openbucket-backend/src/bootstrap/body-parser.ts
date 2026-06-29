import { type Express, json, urlencoded } from 'express';

/**
 * Mount JSON + url-encoded parsers on `/api/admin/*` only.
 *
 * Per WHITEPAPER §1.2.2: every other route — every S3 request and the
 * `/admin/*` SPA paths — must receive `req` as a live readable stream
 * so the storage layer can pipe object PUT bodies straight to disk.
 */
export function configureBodyParsers(app: Express): void {
  // JSON for admin API only. 1 MiB is generous for admin payloads;
  // anything larger is a bug, not a feature.
  const adminJson = json({ limit: '1mb', strict: true });
  const adminForm = urlencoded({ limit: '1mb', extended: false });

  app.use('/api/admin', adminJson);
  app.use('/api/admin', adminForm);

  // Everything else (including /admin/* SPA paths and S3 paths) stays raw.
  // S3 XML bodies are parsed by the S3 XML interceptor (EPIC-02).
}
