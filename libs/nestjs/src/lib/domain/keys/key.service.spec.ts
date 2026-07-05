import { MikroORM, EntityManager } from '@mikro-orm/libsql';
import { ReflectMetadataProvider } from '@mikro-orm/core';
import { Migrator } from '@mikro-orm/migrations';
import { ConfigService } from '@nestjs/config';

import {
  Bucket,
  ObjectEntity,
  ObjectVersion,
  MultipartUpload,
  MultipartPart,
  AccessKey,
  AdminUser,
  RefreshToken,
  LifecycleState,
} from '../../persistence/index';
import { KeyService } from './key.service';
import { SecretCipher } from './secret-cipher';
import type { KeyService as StorageKeyService } from '../../storage/key.service';
import { parseScopePolicy } from './key-scope';
import { Migration20260520000001_initial } from '../../migrations/Migration20260520000001_initial';
import { Migration20260609000001_access_key_admin_fields } from '../../migrations/Migration20260609000001_access_key_admin_fields';
import { Migration20260704000001_access_key_scope } from '../../migrations/Migration20260704000001_access_key_scope';

const ENTITIES = [
  Bucket,
  ObjectEntity,
  ObjectVersion,
  MultipartUpload,
  MultipartPart,
  AccessKey,
  AdminUser,
  RefreshToken,
  LifecycleState,
];

const cfg = ({ get: () => 'domain-key-secret-material' }) as unknown as ConfigService;

/**
 * TASK-3001/3003 / [TEST-1000] — domain KeyService: reversible secret storage,
 * scope compilation, and cache invalidation on revoke.
 */
describe('domain KeyService (TASK-3001/3003)', () => {
  let orm: MikroORM;

  beforeAll(async () => {
    orm = await MikroORM.init({
      dbName: ':memory:',
      entities: ENTITIES,
      metadataProvider: ReflectMetadataProvider,
      metadataCache: { enabled: false },
      allowGlobalContext: true,
      forceUtcTimezone: true,
      extensions: [Migrator],
      migrations: {
        migrationsList: [
          { name: 'Migration20260520000001_initial', class: Migration20260520000001_initial },
          {
            name: 'Migration20260609000001_access_key_admin_fields',
            class: Migration20260609000001_access_key_admin_fields,
          },
          {
            name: 'Migration20260704000001_access_key_scope',
            class: Migration20260704000001_access_key_scope,
          },
        ],
      },
    });
    await orm.getMigrator().up();
  }, 60_000);

  afterAll(async () => {
    await orm?.close(true);
  });

  const make = () => {
    const cipher = new SecretCipher(cfg);
    const storageKeys = { invalidate: jest.fn() };
    const svc = new KeyService(
      orm.em as EntityManager,
      cipher,
      storageKeys as unknown as StorageKeyService,
    );
    return { svc, cipher, storageKeys };
  };

  it('create (unscoped) stores an encrypted secret recoverable to the plaintext', async () => {
    const { svc, cipher } = make();
    const created = await svc.create({ label: 'ci', role: 'root' });

    expect(created.scopePolicy).toBeNull();
    const row = await orm.em.fork().findOne(AccessKey, { id: created.id });
    expect(row?.secretEncrypted).toBeTruthy();
    expect(row?.secretHash).toMatch(/^\$argon2id\$/);
    // The stored blob is NOT the plaintext, but decrypts back to it.
    expect(row?.secretEncrypted).not.toContain(created.secretAccessKey);
    expect(cipher.decrypt(row?.secretEncrypted as string)).toBe(created.secretAccessKey);
  });

  it('create (scoped) compiles + persists a scopePolicy document', async () => {
    const { svc } = make();
    const created = await svc.create({
      label: 'tenant',
      role: 'root',
      scope: { kind: 'prefix', bucket: 't-a', prefix: 'tenant-a/' },
    });

    expect(created.scopePolicy).toBeTruthy();
    const doc = parseScopePolicy(created.scopePolicy);
    expect(doc?.Statement.find((s) => s.Sid === 'ScopeObjects')?.Resource).toBe(
      'arn:aws:s3:::t-a/tenant-a/*',
    );
  });

  it('update invalidates the SigV4 cache for the affected key', async () => {
    const { svc, storageKeys } = make();
    const created = await svc.create({ label: 'x', role: 'root' });
    await svc.update(created.id, { disabled: true });
    expect(storageKeys.invalidate).toHaveBeenCalledWith(created.accessKeyId);
  });

  it('delete invalidates the SigV4 cache for the removed key', async () => {
    const { svc, storageKeys } = make();
    const created = await svc.create({ label: 'y', role: 'root' });
    await svc.delete(created.id);
    expect(storageKeys.invalidate).toHaveBeenCalledWith(created.accessKeyId);
    expect(await orm.em.fork().findOne(AccessKey, { id: created.id })).toBeNull();
  });
});
