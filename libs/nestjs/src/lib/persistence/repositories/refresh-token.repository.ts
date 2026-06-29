import { EntityRepository } from '@mikro-orm/better-sqlite';
import { v7 as uuidv7 } from 'uuid';

import { RefreshToken } from '../entities/refresh-token.entity';

/** Insert payload for a freshly minted refresh-token row (§5.2.3). */
export interface RefreshTokenInsert {
  lookup: string;
  hash: string;
  subjectId: string;
  username: string;
  issuedAt: Date;
  expiresAt: Date;
  rotatedFromId: string | null;
  rotatedAt: Date | null;
  revokedAt: Date | null;
}

/**
 * Refresh-token persistence (§5.2.3). `findByLookup` resolves a row by its
 * indexed SHA-256; the service then argon2-verifies the `hash`.
 */
export class RefreshTokenRepository extends EntityRepository<RefreshToken> {
  /**
   * Persist a new row, generating the uuid-v7 primary key (also the JTI), and
   * return it. Returns the id (not void) so the signature stays compatible with
   * the overridden `EntityRepository.insert`, which resolves to the primary key.
   */
  async insert(data: RefreshTokenInsert): Promise<string> {
    const em = this.getEntityManager();
    const row = em.create(RefreshToken, { id: uuidv7(), ...data });
    await em.persistAndFlush(row);
    return row.id;
  }

  /** Resolve a row by its indexed lookup hash (strict null). */
  async findByLookup(lookup: string): Promise<RefreshToken | null> {
    return this.findOne({ lookup });
  }

  /** Mark a token rotated (used → child minted). */
  async markRotated(id: string, at: Date): Promise<void> {
    await this.getEntityManager().nativeUpdate(RefreshToken, { id }, { rotatedAt: at });
  }

  /** Mark a token revoked. */
  async revoke(id: string, at: Date): Promise<void> {
    await this.getEntityManager().nativeUpdate(RefreshToken, { id }, { revokedAt: at });
  }

  /**
   * Revoke a token and every token descended from it via rotation. Called on
   * reuse-detection: a stolen token replayed after rotation revokes the whole
   * chain it spawned (self-detected lockout). Chains are short, so descendants
   * are walked iteratively.
   */
  async revokeDescendants(id: string): Promise<void> {
    const em = this.getEntityManager();
    const now = new Date();
    const ids = new Set<string>([id]);
    let frontier = [id];
    while (frontier.length > 0) {
      const children = await this.find({ rotatedFromId: { $in: frontier } });
      const next: string[] = [];
      for (const child of children) {
        if (!ids.has(child.id)) {
          ids.add(child.id);
          next.push(child.id);
        }
      }
      frontier = next;
    }
    await em.nativeUpdate(RefreshToken, { id: { $in: [...ids] } }, { revokedAt: now });
  }
}
