import { Injectable } from '@nestjs/common';
import { EntityManager } from '@mikro-orm/libsql';
import { InjectEntityManager } from '@mikro-orm/nestjs';
import { randomBytes } from 'node:crypto';
import { v7 as uuidv7 } from 'uuid';
import * as argon2 from 'argon2';

import { AccessKey } from '../../persistence/index';
import { OPEN_BUCKET_ORM_CONTEXT } from '../../persistence/orm-context';
import { KeyService as StorageKeyService } from '../../storage/key.service';
import { SecretCipher } from './secret-cipher';
import { compileScopeToPolicy, serializeScope, type KeyScope } from './key-scope';

/** Admin create-key input (§5.7). `role` is hard-coded `root` in v1. */
export interface CreateKeyInput {
  label: string;
  role: string;
  /** Optional scope (EPIC-11); compiled + stored as `scopePolicy`. Absent ⇒ unscoped. */
  scope?: KeyScope;
}

/** Result of creating a key — the plaintext secret is surfaced here ONCE. */
export interface CreatedKey {
  id: string;
  accessKeyId: string;
  secretAccessKey: string;
  label: string;
  role: string;
  createdAt: Date;
  /** Compiled scope document (JSON text), or null for an unscoped key. */
  scopePolicy: string | null;
}

/** Admin update-key changes (§5.7) — relabel and/or disable. */
export interface UpdateKeyInput {
  label?: string;
  disabled?: boolean;
}

/**
 * Admin access-key management (§5.7), distinct from the SigV4 `KeyService` in
 * `storage/`. Stores the argon2id hash (defence-in-depth) AND — since EPIC-11
 * (TASK-3001) — the secret encrypted at rest via {@link SecretCipher}, so a
 * scoped sub-key can SigV4-authenticate. The plaintext is returned exactly once
 * at creation and never persisted in the clear.
 */
@Injectable()
export class KeyService {
  constructor(
    @InjectEntityManager(OPEN_BUCKET_ORM_CONTEXT) private readonly em: EntityManager,
    private readonly cipher: SecretCipher,
    private readonly storageKeys: StorageKeyService,
  ) {}

  async list(): Promise<AccessKey[]> {
    return this.em.fork().find(AccessKey, {}, { orderBy: { createdAt: 'ASC' } });
  }

  /** Find a stored key by its admin id (uuid v7); null if unknown. */
  async findById(id: string): Promise<AccessKey | null> {
    return this.em.fork().findOne(AccessKey, { id });
  }

  /**
   * Mint a fresh secret pair: the plaintext (returned once), its argon2id hash
   * (defence-in-depth), and the at-rest GCM ciphertext SigV4 verification uses.
   * Shared by {@link create} and {@link rotate} so the two never drift.
   */
  private async mintSecret(): Promise<{
    secretAccessKey: string;
    secretHash: string;
    secretEncrypted: string;
  }> {
    const secretAccessKey = randomBytes(30).toString('base64url'); // 40 chars
    const secretHash = await argon2.hash(secretAccessKey, { type: argon2.argon2id });
    const secretEncrypted = this.cipher.encrypt(secretAccessKey);
    return { secretAccessKey, secretHash, secretEncrypted };
  }

  async create(input: CreateKeyInput): Promise<CreatedKey> {
    const em = this.em.fork();
    const id = uuidv7();
    const accessKeyId = `AKIA${randomBytes(8).toString('hex').toUpperCase()}`; // 20 chars, [A-Z0-9]
    const { secretAccessKey, secretHash, secretEncrypted } = await this.mintSecret();
    const scopePolicy = input.scope ? serializeScope(compileScopeToPolicy(input.scope)) : null;

    const row = em.create(AccessKey, {
      id,
      accessKeyId,
      secretHash,
      secretEncrypted,
      scopePolicy,
      label: input.label,
      role: input.role,
    });
    await em.persistAndFlush(row);

    return {
      id,
      accessKeyId,
      secretAccessKey,
      label: row.label,
      role: row.role,
      createdAt: row.createdAt,
      scopePolicy: row.scopePolicy ?? null,
    };
  }

  /** Apply label/disabled changes by admin id; null if no such key. */
  async update(id: string, changes: UpdateKeyInput): Promise<AccessKey | null> {
    const em = this.em.fork();
    const row = await em.findOne(AccessKey, { id });
    if (!row) return null;
    if (changes.label !== undefined) row.label = changes.label;
    if (changes.disabled !== undefined) row.disabled = changes.disabled;
    await em.flush();
    // Drop the in-memory SigV4 cache so a disable/relabel takes effect at once —
    // otherwise a revoked key could keep authenticating for the cache lifetime.
    this.storageKeys.invalidate(row.accessKeyId);
    return row;
  }

  /**
   * Rotate a key's secret (EPIC-11, TASK-3010): re-mint the plaintext + hash +
   * at-rest ciphertext in place — `id`, `accessKeyId`, `scopePolicy`, `label`
   * and `role` are untouched (a secret roll, not a new key). The new plaintext
   * is surfaced ONCE (like create) and the SigV4 cache is invalidated so the old
   * secret stops verifying in-process immediately. Null if no such key.
   */
  async rotate(id: string): Promise<CreatedKey | null> {
    const em = this.em.fork();
    const row = await em.findOne(AccessKey, { id });
    if (!row) return null;
    const { secretAccessKey, secretHash, secretEncrypted } = await this.mintSecret();
    row.secretHash = secretHash;
    row.secretEncrypted = secretEncrypted;
    await em.flush();
    // Drop the cached (old-secret) entry so the rolled secret takes effect now.
    this.storageKeys.invalidate(row.accessKeyId);
    return {
      id: row.id,
      accessKeyId: row.accessKeyId,
      secretAccessKey,
      label: row.label,
      role: row.role,
      createdAt: row.createdAt,
      scopePolicy: row.scopePolicy ?? null,
    };
  }

  /**
   * Revoke a key (EPIC-11, TASK-3010): set `disabled = true` and invalidate the
   * SigV4 cache so a signed request stops authenticating at once. Distinct from
   * {@link delete} — the row (and its `accessKeyId`) is kept for the audit trail
   * and can be re-enabled via {@link update}. Null if no such key.
   */
  async revoke(id: string): Promise<AccessKey | null> {
    const em = this.em.fork();
    const row = await em.findOne(AccessKey, { id });
    if (!row) return null;
    row.disabled = true;
    await em.flush();
    this.storageKeys.invalidate(row.accessKeyId);
    return row;
  }

  /** Delete a key by admin id; a no-op if it is already gone. */
  async delete(id: string): Promise<void> {
    const em = this.em.fork();
    const row = await em.findOne(AccessKey, { id });
    if (row) {
      const { accessKeyId } = row;
      await em.removeAndFlush(row);
      this.storageKeys.invalidate(accessKeyId);
    }
  }
}
