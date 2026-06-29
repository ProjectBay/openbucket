import { UnauthorizedException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import * as argon2 from 'argon2';

import { RefreshTokenService } from './refresh-token.service';
import type { Clock } from '../../common/clock/clock';
import type { RefreshTokenRepository } from '../../persistence/index';

/**
 * TEST-0402 — RefreshTokenService (§5.2.3). Exercises every branch of mint,
 * rotate, and revoke against an in-memory fake repository and a controllable
 * Clock. argon2 is real (not mocked): this is the security-critical token gate,
 * so the test verifies the mint→rotate round-trip through actual hashing.
 */

const TTL_MS = 7 * 24 * 60 * 60 * 1000;
const START = Date.UTC(2030, 0, 1);

const sha256hex = (s: string): string => createHash('sha256').update(s).digest('hex');

interface Row {
  id: string;
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

/** In-memory stand-in for RefreshTokenRepository, keyed by the generated id. */
class FakeRepo {
  rows = new Map<string, Row>();
  private seq = 0;
  revokeCalls = 0;
  revokeDescendantsCalls: string[] = [];

  async insert(data: Omit<Row, 'id'>): Promise<void> {
    const id = `tok-${++this.seq}`;
    this.rows.set(id, { id, ...data });
  }

  async findByLookup(lookup: string): Promise<Row | null> {
    for (const row of this.rows.values()) if (row.lookup === lookup) return row;
    return null;
  }

  async markRotated(id: string, at: Date): Promise<void> {
    const row = this.rows.get(id);
    if (row) row.rotatedAt = at;
  }

  async revoke(id: string, at: Date): Promise<void> {
    this.revokeCalls++;
    const row = this.rows.get(id);
    if (row) row.revokedAt = at;
  }

  /** Revoke a token and everything descended from it via rotatedFromId. */
  async revokeDescendants(id: string): Promise<void> {
    this.revokeDescendantsCalls.push(id);
    const ids = new Set<string>([id]);
    let frontier = [id];
    while (frontier.length > 0) {
      const next: string[] = [];
      for (const row of this.rows.values()) {
        if (row.rotatedFromId && frontier.includes(row.rotatedFromId) && !ids.has(row.id)) {
          ids.add(row.id);
          next.push(row.id);
        }
      }
      frontier = next;
    }
    const at = new Date();
    for (const rid of ids) {
      const row = this.rows.get(rid);
      if (row) row.revokedAt = at;
    }
  }
}

function makeClock(startMs: number) {
  let ms = startMs;
  const clock = { nowMs: () => ms, now: () => new Date(ms) } as unknown as Clock;
  return { clock, advance: (delta: number) => (ms += delta) };
}

function build(startMs = START) {
  const repo = new FakeRepo();
  const { clock, advance } = makeClock(startMs);
  const svc = new RefreshTokenService(repo as unknown as RefreshTokenRepository, clock);
  return { repo, svc, advance };
}

describe('RefreshTokenService (TEST-0402)', () => {
  it('case 1: mint → 43-char base64url token, sha256 lookup, argon2id hash, 7d expiry', async () => {
    const { repo, svc } = build();

    const minted = await svc.mint('admin', 'admin');

    expect(minted.token).toMatch(/^[A-Za-z0-9_-]{43}$/); // 32 bytes, base64url, no padding
    expect(minted.expiresAt.getTime()).toBe(START + TTL_MS);

    const [row] = [...repo.rows.values()];
    expect(row.lookup).toBe(sha256hex(minted.token));
    expect(row.hash.startsWith('$argon2id$')).toBe(true);
    expect(await argon2.verify(row.hash, minted.token)).toBe(true);
    expect(row.subjectId).toBe('admin');
    expect(row.username).toBe('admin');
    expect(row.rotatedFromId).toBeNull();
    expect(row.rotatedAt).toBeNull();
    expect(row.revokedAt).toBeNull();
    expect(row.expiresAt).toEqual(minted.expiresAt);
  });

  it('case 2: rotate fresh row → marks parent rotated, mints child linked via rotatedFromId', async () => {
    const { repo, svc } = build();
    const parentRaw = (await svc.mint('admin', 'admin')).token;
    const parent = await repo.findByLookup(sha256hex(parentRaw));

    const rotated = await svc.rotate(parentRaw);

    expect(parent!.rotatedAt).toEqual(new Date(START));
    expect(rotated.subjectId).toBe('admin');
    expect(rotated.username).toBe('admin');
    expect(rotated.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(rotated.token).not.toBe(parentRaw);

    const child = [...repo.rows.values()].find((r) => r.rotatedFromId !== null);
    expect(child).toBeDefined();
    expect(child!.rotatedFromId).toBe(parent!.id);
    expect(child!.lookup).toBe(sha256hex(rotated.token));
  });

  it('case 3: rotate unknown lookup → UnauthorizedException(invalid refresh)', async () => {
    const { svc } = build();
    await expect(svc.rotate('does-not-exist')).rejects.toThrow(UnauthorizedException);
    await expect(svc.rotate('does-not-exist')).rejects.toThrow('invalid refresh');
  });

  it('case 4: rotate revoked row → revoked', async () => {
    const { repo, svc } = build();
    const raw = (await svc.mint('admin', 'admin')).token;
    (await repo.findByLookup(sha256hex(raw)))!.revokedAt = new Date(START);

    await expect(svc.rotate(raw)).rejects.toThrow('revoked');
  });

  it('case 5: rotate expired row → expired', async () => {
    const { svc, advance } = build();
    const raw = (await svc.mint('admin', 'admin')).token;
    advance(TTL_MS + 1); // past the 7-day TTL per the injected clock

    await expect(svc.rotate(raw)).rejects.toThrow('expired');
  });

  it('case 6: rotate an already-rotated token → revokeDescendants + token reuse detected', async () => {
    const { repo, svc } = build();
    const raw = (await svc.mint('admin', 'admin')).token;
    const parent = await repo.findByLookup(sha256hex(raw));
    const firstRotation = await svc.rotate(raw); // legitimate use → parent.rotatedAt set
    const child = await repo.findByLookup(sha256hex(firstRotation.token));

    await expect(svc.rotate(raw)).rejects.toThrow('token reuse detected');

    expect(repo.revokeDescendantsCalls).toContain(parent!.id);
    expect(parent!.revokedAt).not.toBeNull(); // whole chain revoked
    expect(child!.revokedAt).not.toBeNull();
  });

  it('case 7: rotate with a non-matching argon2 hash → invalid refresh', async () => {
    const { repo, svc } = build();
    const presented = 'presented-but-wrong';
    // Craft a row whose lookup matches the presented token but whose argon2 hash
    // is for a different secret — so findByLookup hits but verify fails.
    await repo.insert({
      lookup: sha256hex(presented),
      hash: await argon2.hash('a-different-secret', { type: argon2.argon2id }),
      subjectId: 'admin',
      username: 'admin',
      issuedAt: new Date(START),
      expiresAt: new Date(START + TTL_MS),
      rotatedFromId: null,
      rotatedAt: null,
      revokedAt: null,
    });

    await expect(svc.rotate(presented)).rejects.toThrow('invalid refresh');
  });

  it('case 8: revoke unknown token → no-op (no repo write)', async () => {
    const { repo, svc } = build();
    await svc.revoke('not-a-token');
    expect(repo.revokeCalls).toBe(0);
  });

  it('case 9: revoke already-revoked token → no-op', async () => {
    const { repo, svc } = build();
    const raw = (await svc.mint('admin', 'admin')).token;
    (await repo.findByLookup(sha256hex(raw)))!.revokedAt = new Date(START);

    await svc.revoke(raw);
    expect(repo.revokeCalls).toBe(0);
  });

  it('case 10: revoke a valid token → repo.revoke(id, now) exactly once', async () => {
    const { repo, svc } = build();
    const raw = (await svc.mint('admin', 'admin')).token;
    const row = await repo.findByLookup(sha256hex(raw));

    await svc.revoke(raw);

    expect(repo.revokeCalls).toBe(1);
    expect(row!.revokedAt).toEqual(new Date(START));
  });
});
