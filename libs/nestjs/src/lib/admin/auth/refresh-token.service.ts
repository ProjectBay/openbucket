import { Injectable, UnauthorizedException } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import * as argon2 from 'argon2';

import { RefreshTokenRepository } from '../../persistence/index';

import { Clock } from '../../common/clock/clock';

/** A freshly minted refresh token (raw value + absolute expiry). */
export interface MintedRefreshToken {
  /** Opaque raw token; the controller sets it as the refresh cookie. */
  token: string;
  expiresAt: Date;
}

/** The result of rotating a presented refresh token. */
export interface RotatedRefreshToken extends MintedRefreshToken {
  /** Admin subject id — the username (the AdminUser primary key). */
  subjectId: string;
  username: string;
}

/**
 * Refresh-token lifecycle (§5.2.3): mint, rotate (with reuse revocation), revoke.
 *
 * The raw token is a 32-byte base64url string returned to the caller and never
 * stored. Each row keeps an indexed SHA-256 `lookup` (to find the row in one
 * query) and an argon2id `hash` (the cryptographic gate). Every rotation mints a
 * child linked via `rotatedFromId`; replaying an already-rotated token is read
 * as theft and revokes the whole chain it spawned (self-detected lockout).
 *
 * Time comes from the injected {@link Clock} (not `Date.now()`) so conformance
 * tests can fast-forward past the TTL without sleeping (§4.11).
 */
@Injectable()
export class RefreshTokenService {
  private static readonly TTL_MS = 7 * 24 * 60 * 60 * 1000;

  constructor(
    private readonly repo: RefreshTokenRepository,
    private readonly clock: Clock,
  ) {}

  async mint(
    subjectId: string,
    username: string,
    rotatedFromId?: string,
  ): Promise<MintedRefreshToken> {
    const raw = randomBytes(32).toString('base64url');
    const lookup = createHash('sha256').update(raw).digest('hex'); // indexed
    const hash = await argon2.hash(raw, { type: argon2.argon2id });
    const expiresAt = new Date(this.clock.nowMs() + RefreshTokenService.TTL_MS);

    await this.repo.insert({
      lookup,
      hash,
      subjectId,
      username,
      issuedAt: this.clock.now(),
      expiresAt,
      rotatedFromId: rotatedFromId ?? null,
      rotatedAt: null,
      revokedAt: null,
    });

    return { token: raw, expiresAt };
  }

  async rotate(rawToken: string): Promise<RotatedRefreshToken> {
    const lookup = createHash('sha256').update(rawToken).digest('hex');
    const row = await this.repo.findByLookup(lookup);
    if (!row) throw new UnauthorizedException('invalid refresh');

    if (row.revokedAt) throw new UnauthorizedException('revoked');
    if (row.expiresAt.getTime() < this.clock.nowMs()) {
      throw new UnauthorizedException('expired');
    }

    if (row.rotatedAt) {
      // Reuse of an already-rotated token — treat as compromise and revoke the
      // entire chain descended from it. A lookup match implies raw possession
      // (lookup = sha256(raw)), so this fires before the argon2 gate.
      await this.repo.revokeDescendants(row.id);
      throw new UnauthorizedException('token reuse detected');
    }

    const ok = await argon2.verify(row.hash, rawToken);
    if (!ok) throw new UnauthorizedException('invalid refresh');

    await this.repo.markRotated(row.id, this.clock.now());
    const minted = await this.mint(row.subjectId, row.username, row.id);
    return { ...minted, subjectId: row.subjectId, username: row.username };
  }

  async revoke(rawToken: string): Promise<void> {
    const lookup = createHash('sha256').update(rawToken).digest('hex');
    const row = await this.repo.findByLookup(lookup);
    if (!row || row.revokedAt) return; // idempotent on missing / already-revoked
    await this.repo.revoke(row.id, this.clock.now());
  }

  /**
   * Revoke every live refresh token for a subject (TASK-2101, CWE-613). Called on
   * password change to evict any attacker still holding a stolen `ob_refresh`
   * cookie — after this, {@link rotate} rejects their token at the `revokedAt`
   * gate. Stateless 15-minute access JWTs are unaffected (out of scope).
   */
  async revokeAllForSubject(subjectId: string): Promise<void> {
    await this.repo.revokeAllForSubject(subjectId, this.clock.now());
  }
}
