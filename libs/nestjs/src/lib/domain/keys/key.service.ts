import { Injectable } from '@nestjs/common';
import { EntityManager } from '@mikro-orm/libsql';
import { InjectEntityManager } from '@mikro-orm/nestjs';
import { randomBytes } from 'node:crypto';
import { v7 as uuidv7 } from 'uuid';
import * as argon2 from 'argon2';

import { AccessKey } from '../../persistence/index';
import { OPEN_BUCKET_ORM_CONTEXT } from '../../persistence/orm-context';

/** Admin create-key input (§5.7). `role` is hard-coded `root` in v1. */
export interface CreateKeyInput {
  label: string;
  role: string;
}

/** Result of creating a key — the plaintext secret is surfaced here ONCE. */
export interface CreatedKey {
  id: string;
  accessKeyId: string;
  secretAccessKey: string;
  label: string;
  role: string;
  createdAt: Date;
}

/** Admin update-key changes (§5.7) — relabel and/or disable. */
export interface UpdateKeyInput {
  label?: string;
  disabled?: boolean;
}

/**
 * Admin access-key management (§5.7), distinct from the SigV4 `KeyService` in
 * `storage/` (which only resolves the env root key for request signing). Stores
 * only the argon2id hash of the secret; the plaintext is returned exactly once
 * at creation. (Sub-keys are not yet usable for SigV4 in v1 — the verifier needs
 * plaintext it does not have; see storage/key.service.ts.)
 */
@Injectable()
export class KeyService {
  constructor(@InjectEntityManager(OPEN_BUCKET_ORM_CONTEXT) private readonly em: EntityManager) {}

  async list(): Promise<AccessKey[]> {
    return this.em.fork().find(AccessKey, {}, { orderBy: { createdAt: 'ASC' } });
  }

  async create(input: CreateKeyInput): Promise<CreatedKey> {
    const em = this.em.fork();
    const id = uuidv7();
    const accessKeyId = `AKIA${randomBytes(8).toString('hex').toUpperCase()}`; // 20 chars, [A-Z0-9]
    const secretAccessKey = randomBytes(30).toString('base64url'); // 40 chars
    const secretHash = await argon2.hash(secretAccessKey, { type: argon2.argon2id });

    const row = em.create(AccessKey, {
      id,
      accessKeyId,
      secretHash,
      label: input.label,
      role: input.role,
    });
    await em.persistAndFlush(row);

    return { id, accessKeyId, secretAccessKey, label: row.label, role: row.role, createdAt: row.createdAt };
  }

  /** Apply label/disabled changes by admin id; null if no such key. */
  async update(id: string, changes: UpdateKeyInput): Promise<AccessKey | null> {
    const em = this.em.fork();
    const row = await em.findOne(AccessKey, { id });
    if (!row) return null;
    if (changes.label !== undefined) row.label = changes.label;
    if (changes.disabled !== undefined) row.disabled = changes.disabled;
    await em.flush();
    return row;
  }

  /** Delete a key by admin id; a no-op if it is already gone. */
  async delete(id: string): Promise<void> {
    const em = this.em.fork();
    const row = await em.findOne(AccessKey, { id });
    if (row) await em.removeAndFlush(row);
  }
}
