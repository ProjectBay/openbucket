/**
 * The running `@openbucket/nestjs` version, surfaced by the admin API
 * (`GET /api/admin/version`) so the admin console can display it and check
 * GitHub for a newer release.
 *
 * Bump this in lockstep with `libs/nestjs/package.json` on every release — the
 * release-nestjs workflow verifies the tag against package.json, and this
 * constant must match. (No build-time JSON import: the standalone app is bundled
 * and can't reliably read package.json at runtime.)
 */
export const OPENBUCKET_VERSION = '0.1.0-alpha.9';
