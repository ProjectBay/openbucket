import { SetMetadata, CustomDecorator } from '@nestjs/common';

/**
 * Marks a route as exempt from the admin JWT guard. In M0 there is no guard
 * yet, so this is an inert metadata marker; EPIC-05's JwtAuthGuard reads
 * IS_PUBLIC_KEY to skip authentication on decorated handlers. See WHITEPAPER
 * §1.8 (health/readiness are @Public) and §5.3 (JwtAuthGuard).
 */
export const IS_PUBLIC_KEY = 'openbucket:isPublic';

export const Public = (): CustomDecorator<string> => SetMetadata(IS_PUBLIC_KEY, true);
