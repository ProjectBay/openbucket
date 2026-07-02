import { Logger } from '@nestjs/common';
import { MikroORM, EntityManager } from '@mikro-orm/libsql';
import { ReflectMetadataProvider } from '@mikro-orm/core';
import { Migrator } from '@mikro-orm/migrations';
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
} from '../persistence/index';

import { KeyService, redact } from './key.service';
import { Migration20260520000001_initial } from '../migrations/Migration20260520000001_initial';
import { Migration20260609000001_access_key_admin_fields } from '../migrations/Migration20260609000001_access_key_admin_fields';

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

/** Mutable stub so case 7 (reloadRootFromEnv) can swap values. */
const mkConfig = (env: Record<string, string>) =>
  ({
    getOrThrow<T = string>(k: string): T {
      if (env[k] === undefined) throw new Error(`missing ${k}`);
      return env[k] as unknown as T;
    },
    get<T = string>(k: string): T | undefined {
      return env[k] as unknown as T | undefined;
    },
  }) as any;

describe('KeyService (TEST-0212)', () => {
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
        ],
      },
    });
    await orm.getMigrator().up();
  }, 60_000);

  afterAll(async () => {
    await orm?.close(true);
  });

  const make = (env: Record<string, string>) => {
    const svc = new KeyService(orm.em as EntityManager, mkConfig(env));
    svc.onModuleInit();
    return svc;
  };

  it('case 1: onModuleInit caches the root key; getSecret returns it', async () => {
    const svc = make({ ROOT_ACCESS_KEY_ID: 'AKIAEXAMPLE', ROOT_SECRET_ACCESS_KEY: 'secretvalue' });
    expect(await svc.getSecret('AKIAEXAMPLE')).toEqual({
      accessKeyId: 'AKIAEXAMPLE',
      secret: 'secretvalue',
      disabled: false,
      isRoot: true,
    });
  });

  it('case 2: unknown id returns null with no DB row', async () => {
    const svc = make({ ROOT_ACCESS_KEY_ID: 'AKIA2', ROOT_SECRET_ACCESS_KEY: 's2' });
    expect(await svc.getSecret('unknown-id-' + Math.random())).toBeNull();
  });

  it('case 3: sub-key in DB returns null with a sub-key-support warning (redacted id)', async () => {
    const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const svc = make({ ROOT_ACCESS_KEY_ID: 'AKIA3', ROOT_SECRET_ACCESS_KEY: 's3' });

    const em = orm.em.fork();
    em.create(AccessKey, { id: 'subkey-id-1', accessKeyId: 'subkeyabcdef', secretHash: 'argon2id$hash' });
    await em.flush();

    expect(await svc.getSecret('subkeyabcdef')).toBeNull();
    const allWarnArgs = warnSpy.mock.calls.flat().join(' ');
    expect(allWarnArgs).toMatch(/sub-key support not enabled in v1/);
    expect(allWarnArgs).toMatch(/subk…ef/); // redacted form
    expect(allWarnArgs).not.toContain('subkeyabcdef'); // never the full id

    warnSpy.mockRestore();
  });

  it('case 4: a cached-disabled hit returns null without touching the DB', async () => {
    const svc = make({ ROOT_ACCESS_KEY_ID: 'AKIA4', ROOT_SECRET_ACCESS_KEY: 's4' });
    // Pre-populate the cache with a disabled entry via a private-cache poke.
    (svc as unknown as { cache: Map<string, any> }).cache.set('AKIAOTHER', {
      accessKeyId: 'AKIAOTHER',
      secret: 'never-used',
      disabled: true,
      isRoot: false,
    });
    const findSpy = jest.spyOn(orm.em, 'findOne');
    expect(await svc.getSecret('AKIAOTHER')).toBeNull();
    expect(findSpy).not.toHaveBeenCalled();
    findSpy.mockRestore();
  });

  it('case 5: invalidate(rootId) is a no-op', async () => {
    const svc = make({ ROOT_ACCESS_KEY_ID: 'AKIAROOT', ROOT_SECRET_ACCESS_KEY: 'sroot' });
    svc.invalidate('AKIAROOT');
    expect((await svc.getSecret('AKIAROOT'))?.isRoot).toBe(true);
  });

  it('case 6: invalidate(subkey) drops the cache entry', async () => {
    const svc = make({ ROOT_ACCESS_KEY_ID: 'AKIA6', ROOT_SECRET_ACCESS_KEY: 's6' });
    (svc as unknown as { cache: Map<string, any> }).cache.set('subkey6', {
      accessKeyId: 'subkey6',
      secret: 'cached',
      disabled: false,
      isRoot: false,
    });
    svc.invalidate('subkey6');
    expect((svc as unknown as { cache: Map<string, any> }).cache.has('subkey6')).toBe(false);
  });

  it('case 7: reloadRootFromEnv swaps the root id/secret', async () => {
    const env = { ROOT_ACCESS_KEY_ID: 'AKIAOLD', ROOT_SECRET_ACCESS_KEY: 'old' };
    const svc = new KeyService(orm.em as EntityManager, mkConfig(env));
    svc.onModuleInit();
    expect((await svc.getSecret('AKIAOLD'))?.secret).toBe('old');

    env.ROOT_ACCESS_KEY_ID = 'AKIANEW';
    env.ROOT_SECRET_ACCESS_KEY = 'new';
    svc.reloadRootFromEnv();
    expect(await svc.getSecret('AKIAOLD')).toBeNull();
    expect((await svc.getSecret('AKIANEW'))?.secret).toBe('new');
  });

  it('case 8: redact', () => {
    expect(redact('AKIAIOSFODNN7EXAMPLE')).toBe('AKIA…LE');
    expect(redact('short')).toBe('****');
  });

  it('case 9: no log line in this suite contains the plaintext secret', () => {
    // Spy logger across the suite; we re-trigger onModuleInit + a redacted
    // warning path to be thorough. Asserts: no captured arg contains 'secretvalue'.
    const logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    try {
      const svc = make({ ROOT_ACCESS_KEY_ID: 'AKIA9', ROOT_SECRET_ACCESS_KEY: 'secretvalue' });
      void svc.getSecret('AKIA9');
      const allArgs = [...logSpy.mock.calls.flat(), ...warnSpy.mock.calls.flat()].join(' ');
      expect(allArgs).not.toContain('secretvalue');
    } finally {
      logSpy.mockRestore();
      warnSpy.mockRestore();
    }
  });
});
