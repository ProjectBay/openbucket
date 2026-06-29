import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { EntityManager } from '@mikro-orm/better-sqlite';
import { InjectEntityManager } from '@mikro-orm/nestjs';
import { ConfigService } from '@nestjs/config';

import { AccessKey } from '../persistence/index';
import { OPEN_BUCKET_ORM_CONTEXT } from '../persistence/orm-context';

export interface KeyLookupResult {
  accessKeyId: string;
  secret: string;
  disabled: boolean;
  /** True when this key is the root pair from env, not a stored sub-key. */
  isRoot: boolean;
}

@Injectable()
export class KeyService implements OnModuleInit {
  private readonly log = new Logger(KeyService.name);

  /**
   * In-memory cache keyed by accessKeyId. Holds the root pair (loaded at
   * boot from env) and any sub-keys looked up since. Sub-key plaintext
   * support is not wired in v1 (the DB has argon2id hashes only); the
   * interface is forward-compatible. See WHITEPAPER §3.10.
   */
  private readonly cache = new Map<string, KeyLookupResult>();

  constructor(
    @InjectEntityManager(OPEN_BUCKET_ORM_CONTEXT) private readonly em: EntityManager,
    private readonly config: ConfigService,
  ) {}

  onModuleInit(): void {
    const rootId = this.config.getOrThrow<string>('ROOT_ACCESS_KEY_ID');
    const rootSecret = this.config.getOrThrow<string>('ROOT_SECRET_ACCESS_KEY');
    this.cache.set(rootId, {
      accessKeyId: rootId,
      secret: rootSecret,
      disabled: false,
      isRoot: true,
    });
    this.log.log(`KeyService loaded root access key (id=${redact(rootId)})`);
  }

  /**
   * Hot-path lookup for the SigV4 guard. Returns null when the key is
   * unknown OR disabled — both leak the same `null` so the caller can't
   * distinguish. Disabled keys are cached as `disabled: true` so a flood
   * doesn't hammer SQLite.
   */
  async getSecret(accessKeyId: string): Promise<KeyLookupResult | null> {
    const cached = this.cache.get(accessKeyId);
    if (cached) {
      return cached.disabled ? null : cached;
    }

    const row = await this.em.findOne(AccessKey, { accessKeyId });
    if (!row) return null;

    // v1: there is no plaintext-secret path for sub-keys (the DB stores an
    // argon2id hash, which SigV4 can't use). Wired for future expansion.
    this.log.warn(
      `KeyService: accessKeyId=${redact(accessKeyId)} found in DB but no plaintext available — ` +
        'sub-key support not enabled in v1',
    );
    return null;
  }

  /**
   * Invalidate cache entries. Called by the admin API when a key is
   * disabled, deleted, or rotated. The root key is bound to the boot env
   * and is never invalidated this way.
   */
  invalidate(accessKeyId: string): void {
    const cached = this.cache.get(accessKeyId);
    if (cached?.isRoot) return;
    this.cache.delete(accessKeyId);
  }

  /** Test-only and emergency-rotate hook for the root key. */
  reloadRootFromEnv(): void {
    const rootId = this.config.getOrThrow<string>('ROOT_ACCESS_KEY_ID');
    const rootSecret = this.config.getOrThrow<string>('ROOT_SECRET_ACCESS_KEY');
    for (const [id, entry] of this.cache) {
      if (entry.isRoot) this.cache.delete(id);
    }
    this.cache.set(rootId, {
      accessKeyId: rootId,
      secret: rootSecret,
      disabled: false,
      isRoot: true,
    });
  }
}

/** Redact an access key id for safe logging — never reveal the full id. */
export function redact(id: string): string {
  if (id.length <= 8) return '****';
  return `${id.slice(0, 4)}…${id.slice(-2)}`;
}
