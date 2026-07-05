import { MikroORM } from '@mikro-orm/libsql';
import { ReflectMetadataProvider } from '@mikro-orm/core';
import { Migrator } from '@mikro-orm/migrations';

import { UsageSample } from '../persistence/entities/usage-sample.entity';
import { RequestMetricSample } from '../persistence/entities/request-metric-sample.entity';
import { Migration20260705000001_usage_samples } from './Migration20260705000001_usage_samples';

/**
 * TEST-1102 (case 1) — the usage-samples migration applies + reverts cleanly and
 * creates the two tables + their three indexes. `:memory:` is fine here (the
 * migration is standalone DDL with no FKs).
 */
describe('Migration20260705000001_usage_samples (TEST-1102)', () => {
  let orm: MikroORM;

  beforeAll(async () => {
    orm = await MikroORM.init({
      dbName: ':memory:',
      entities: [UsageSample, RequestMetricSample],
      metadataProvider: ReflectMetadataProvider,
      metadataCache: { enabled: false },
      allowGlobalContext: true,
      forceUtcTimezone: true,
      extensions: [Migrator],
      migrations: {
        migrationsList: [
          {
            name: 'Migration20260705000001_usage_samples',
            class: Migration20260705000001_usage_samples,
          },
        ],
      },
    });
    await orm.getMigrator().up();
  }, 60_000);

  afterAll(async () => {
    await orm?.close(true);
  });

  const tableNames = async (): Promise<string[]> => {
    const rows = await orm.em
      .getConnection()
      .execute<{ name: string }[]>(
        `select name from sqlite_master where type='table' and name not like 'sqlite_%' order by name`,
      );
    return rows.map((r) => r.name);
  };

  const indexNames = async (): Promise<string[]> => {
    const rows = await orm.em
      .getConnection()
      .execute<{ name: string }[]>(
        `select name from sqlite_master where type='index' and name not like 'sqlite_autoindex_%'`,
      );
    return rows.map((r) => r.name);
  };

  it('up() creates both sample tables', async () => {
    const names = await tableNames();
    expect(names).toContain('usage_samples');
    expect(names).toContain('request_metric_samples');
  });

  it('up() creates the three indexes', async () => {
    const names = await indexNames();
    for (const ix of [
      'ix_usage_samples_sampled_at',
      'ix_usage_samples_bucket_sampled',
      'ix_request_metric_samples_sampled_at',
    ]) {
      expect(names).toContain(ix);
    }
  });

  // Defined last: mutates the schema for the shared ORM instance.
  it('down() drops both tables', async () => {
    await orm.getMigrator().down();
    const names = await tableNames();
    expect(names).not.toContain('usage_samples');
    expect(names).not.toContain('request_metric_samples');
  });
});
