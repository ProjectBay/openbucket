import { SetMetadata } from '@nestjs/common';

/** Reflector key for the {@link AllowReadOnly} escape hatch (EPIC-11). */
export const ALLOW_READONLY_KEY = 'ob:allow-readonly';

/**
 * Opt a mutating admin handler/class OUT of the `RolesGuard` default-deny so a
 * read-only admin may still call it (EPIC-11, STORY-1002). The guard denies
 * every `POST/PUT/PATCH/DELETE` admin route to a `readonly` principal unless it
 * is marked with this decorator (or sits on the guard's self-service allowlist).
 * Greppable and opt-in: a new mutating route is read-only-safe by default.
 */
export const AllowReadOnly = (): MethodDecorator & ClassDecorator =>
  SetMetadata(ALLOW_READONLY_KEY, true);
