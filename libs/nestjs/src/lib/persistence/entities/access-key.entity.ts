import { Entity, PrimaryKey, Property } from '@mikro-orm/core';

/**
 * S3 access key. `accessKeyId` stays the primary key (the SigV4 hot-path looks
 * keys up by it). `id` is the admin-facing identifier (uuid v7) the SPA / admin
 * API address keys by (§5.7); `role` is hard-coded `root` in v1, and
 * `lastUsedAt` is reserved for usage tracking. The secret is never stored in
 * plaintext — only its argon2id hash.
 */
@Entity({ tableName: 'access_keys' })
export class AccessKey {
  @PrimaryKey({ type: 'string', length: 32 })
  accessKeyId!: string;

  @Property({ type: 'string', length: 64, unique: true })
  id!: string;

  /** argon2id hash of the secret. Never store the plaintext. */
  @Property({ type: 'string', length: 256 })
  secretHash!: string;

  @Property({ type: 'string', length: 128, default: '' })
  label = '';

  @Property({ type: 'string', length: 16, default: 'root' })
  role = 'root';

  @Property({ type: 'datetime' })
  createdAt: Date = new Date();

  @Property({ type: 'datetime', nullable: true })
  lastUsedAt?: Date | null;

  @Property({ type: 'boolean', default: false })
  disabled = false;

  /**
   * Compiled scope `PolicyDocument` (JSON text) for a scoped sub-key
   * (EPIC-11 / STORY-1000). Null ⇒ an unscoped key (root-equivalent grant).
   * Root credentials are loaded from env and never persisted, so they can
   * never carry a scope — the additive/opt-in guarantee holds structurally.
   */
  @Property({ type: 'text', nullable: true })
  scopePolicy?: string | null;

  /**
   * The sub-key secret encrypted at rest with the instance KEK (AES-256-GCM,
   * see `SecretCipher`). NEVER the plaintext — this blob is recoverable only
   * with the KEK and is what SigV4 verification consumes (EPIC-11 / TASK-3001).
   * Null for legacy rows and the env root key.
   */
  @Property({ type: 'text', nullable: true })
  secretEncrypted?: string | null;
}
