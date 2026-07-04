import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';

import { AdminUserRepository } from '../../persistence/index';

import { RefreshTokenService } from './refresh-token.service';

/** Tokens returned to the controller after login/refresh (§5.2.2). */
export interface IssuedTokens {
  accessToken: string;
  expiresIn: number; // seconds
  refreshToken: string; // raw value; controller sets the cookie
  refreshExpiresAt: Date;
}

/**
 * A valid argon2id hash of a throwaway password, used for the constant-time
 * dummy verify on a user miss so login timing doesn't reveal whether a username
 * exists. Must be a real encoded hash (an invalid one makes argon2.verify throw
 * immediately, defeating the timing equalisation).
 */
const DUMMY_HASH =
  '$argon2id$v=19$m=65536,t=3,p=4$uK70xPRYkzzep0z1zfbDTQ$jz8y359hyRBUi4dTRdlvODYJK6oq3AqGHQljDAcb+sM';

/**
 * Admin authentication (§5.2.2). The AdminUser primary key is the username, so
 * it doubles as the JWT `sub`. Issues a 15-minute access JWT plus a rotating
 * refresh token (minted by {@link RefreshTokenService}).
 */
@Injectable()
export class AuthService {
  private static readonly ACCESS_TTL_SECONDS = 15 * 60;

  constructor(
    private readonly jwt: JwtService,
    private readonly users: AdminUserRepository,
    // Named `refreshTokens` (not `refresh`) to avoid colliding with the
    // `refresh()` method below — a property and method can't share a name.
    private readonly refreshTokens: RefreshTokenService,
  ) {}

  async login(username: string, password: string): Promise<IssuedTokens> {
    const user = await this.users.findByUsername(username);
    if (!user) {
      // Constant-time dummy verify to avoid user-enumeration timing.
      await argon2.verify(DUMMY_HASH, password).catch(() => false);
      throw new UnauthorizedException('invalid credentials');
    }

    const ok = await argon2.verify(user.passwordHash, password);
    if (!ok) throw new UnauthorizedException('invalid credentials');

    return this.issueTokens(user.username, user.username, user.mustChangePassword);
  }

  async refresh(rawRefreshToken: string): Promise<IssuedTokens> {
    const rotated = await this.refreshTokens.rotate(rawRefreshToken);
    // Re-derive mustChangePassword from the persisted row rather than hardcoding
    // `false` (TASK-2102, CWE-620): a forced-rotation principal must not be able
    // to shed the claim simply by refreshing. The guard enforces against a fresh
    // DB read too, but keeping the claim truthful avoids handing out a token that
    // advertises a stale `false`.
    const user = await this.users.findByUsername(rotated.username);
    return this.issueTokens(
      rotated.subjectId,
      rotated.username,
      user?.mustChangePassword ?? false,
      rotated.token,
      rotated.expiresAt,
    );
  }

  async logout(rawRefreshToken: string | undefined): Promise<void> {
    if (rawRefreshToken) await this.refreshTokens.revoke(rawRefreshToken);
  }

  private async issueTokens(
    subjectId: string,
    username: string,
    mustChangePassword: boolean,
    preIssuedRefreshRaw?: string,
    preIssuedRefreshExpiresAt?: Date,
  ): Promise<IssuedTokens> {
    const accessToken = await this.jwt.signAsync({
      sub: subjectId,
      username,
      mustChangePassword,
    });

    if (preIssuedRefreshRaw && preIssuedRefreshExpiresAt) {
      return {
        accessToken,
        expiresIn: AuthService.ACCESS_TTL_SECONDS,
        refreshToken: preIssuedRefreshRaw,
        refreshExpiresAt: preIssuedRefreshExpiresAt,
      };
    }

    const minted = await this.refreshTokens.mint(subjectId, username);
    return {
      accessToken,
      expiresIn: AuthService.ACCESS_TTL_SECONDS,
      refreshToken: minted.token,
      refreshExpiresAt: minted.expiresAt,
    };
  }
}
