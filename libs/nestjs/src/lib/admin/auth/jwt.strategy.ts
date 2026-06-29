import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';

/** Decoded admin access-token claims (§5.2.2). */
export interface AdminJwtPayload {
  sub: string;
  username: string;
  mustChangePassword: boolean;
}

/**
 * Passport-JWT strategy for admin access tokens (§5.2). Validates the bearer
 * token's signature, expiry, issuer, and audience against the same parameters
 * AuthModule's JwtModule signs with; the returned payload becomes `req.user`.
 */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(config: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.getOrThrow<string>('JWT_SECRET'),
      issuer: 'openbucket',
      audience: 'openbucket-admin',
    });
  }

  validate(payload: AdminJwtPayload): AdminJwtPayload {
    if (!payload?.sub) throw new UnauthorizedException();
    return {
      sub: payload.sub,
      username: payload.username,
      mustChangePassword: payload.mustChangePassword,
    };
  }
}
