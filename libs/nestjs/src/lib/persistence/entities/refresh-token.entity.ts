import { Entity, Index, PrimaryKey, Property } from '@mikro-orm/core';

import { RefreshTokenRepository } from '../repositories/refresh-token.repository';

/**
 * Refresh-token row (§5.2.3). The raw token is never stored: `lookup` is an
 * indexed SHA-256 used only to find the row, and `hash` is the argon2id gate.
 * Rotation links rows via `rotatedFromId`; `rotatedAt`/`revokedAt` drive
 * reuse-detection and revocation.
 */
@Entity({ tableName: 'refresh_tokens', repository: () => RefreshTokenRepository })
@Index({ name: 'ix_refresh_lookup', properties: ['lookup'] })
@Index({ name: 'ix_refresh_subject', properties: ['subjectId'] })
@Index({ name: 'ix_refresh_expires', properties: ['expiresAt'] })
export class RefreshToken {
  @PrimaryKey({ type: 'string', length: 64 })
  id!: string; // uuid v7 — also the JTI

  /** SHA-256 hex of the raw token — indexed lookup key, NOT the gate. */
  @Property({ type: 'string', length: 64 })
  lookup!: string;

  /** argon2id hash of the raw token — the cryptographic gate. */
  @Property({ type: 'string', length: 256 })
  hash!: string;

  /** Admin subject id — the AdminUser username. */
  @Property({ type: 'string', length: 64 })
  subjectId!: string;

  @Property({ type: 'string', length: 64 })
  username!: string;

  @Property({ type: 'datetime' })
  issuedAt: Date = new Date();

  @Property({ type: 'datetime' })
  expiresAt!: Date;

  /** Parent token id when this row was minted by rotation. */
  @Property({ type: 'string', length: 64, nullable: true })
  rotatedFromId?: string | null;

  /** Set when this token was used to mint a child (rotated). */
  @Property({ type: 'datetime', nullable: true })
  rotatedAt?: Date | null;

  /** Set when revoked — logout, or reuse-detection chain revoke. */
  @Property({ type: 'datetime', nullable: true })
  revokedAt?: Date | null;
}
