import { MikroORM } from '@mikro-orm/libsql';
import { ReflectMetadataProvider } from '@mikro-orm/core';

import { Bucket } from './entities/bucket.entity';
import { MultipartUpload } from './entities/multipart-upload.entity';
import { MultipartPart } from './entities/multipart-part.entity';

/**
 * TEST-0202 — multipart entity cascade and lookup against real :memory: SQLite.
 * Schema built via the SchemaGenerator (initial migration is STORY-0205).
 */
describe('multipart entities (TEST-0202)', () => {
  let orm: MikroORM;

  beforeAll(async () => {
    orm = await MikroORM.init({
      dbName: ':memory:',
      entities: [Bucket, MultipartUpload, MultipartPart],
      metadataProvider: ReflectMetadataProvider,
      metadataCache: { enabled: false },
      allowGlobalContext: true,
      forceUtcTimezone: true,
      pool: {
        afterCreate: (conn: any, done: (err?: Error) => void) => {
          conn.pragma('foreign_keys = ON');
          done();
        },
      },
    });
    await orm.schema.createSchema();
  }, 60_000);

  afterAll(async () => {
    await orm?.close(true);
  });

  const seedUpload = async (uploadId: string, bucketName: string) => {
    const em = orm.em.fork();
    const bucket = em.create(Bucket, { name: bucketName });
    em.create(MultipartUpload, { uploadId, bucket, key: 'k' });
    await em.flush();
  };

  it('case 1: a fresh upload defaults initiator to root', async () => {
    await seedUpload('u1', 'mpb1');
    const em = orm.em.fork();
    const read = await em.findOneOrFail(MultipartUpload, { uploadId: 'u1' });
    expect(read.initiator).toBe('root');
  });

  it('case 2: parts populate and cover part numbers 1..3', async () => {
    await seedUpload('u2', 'mpb2');
    const em = orm.em.fork();
    const upload = await em.findOneOrFail(MultipartUpload, { uploadId: 'u2' });
    for (const partNumber of [1, 2, 3]) {
      em.create(MultipartPart, { upload, partNumber, etag: `e${partNumber}`, size: BigInt(partNumber) });
    }
    await em.flush();
    em.clear();

    const read = await em.findOneOrFail(MultipartUpload, { uploadId: 'u2' }, { populate: ['parts'] });
    expect(read.parts).toHaveLength(3);
    expect(read.parts.getItems().map((p) => p.partNumber).sort((a, b) => a - b)).toEqual([1, 2, 3]);
  });

  it('case 3: composite PK rejects a duplicate (upload, partNumber)', async () => {
    await seedUpload('u3', 'mpb3');

    const em1 = orm.em.fork();
    em1.create(MultipartPart, { upload: await em1.findOneOrFail(MultipartUpload, { uploadId: 'u3' }), partNumber: 1, etag: 'e' });
    await em1.flush();

    // A second EM (fresh identity map) re-inserting the same PK hits the DB
    // constraint — two creates in one UoW would merge in the identity map.
    const em2 = orm.em.fork();
    em2.create(MultipartPart, { upload: await em2.findOneOrFail(MultipartUpload, { uploadId: 'u3' }), partNumber: 1, etag: 'e-dup' });
    await expect(em2.flush()).rejects.toThrow();
  });

  it('case 4: removing the upload cascade-deletes its parts', async () => {
    await seedUpload('u4', 'mpb4');
    const em = orm.em.fork();
    const upload = await em.findOneOrFail(MultipartUpload, { uploadId: 'u4' });
    em.create(MultipartPart, { upload, partNumber: 1, etag: 'e1' });
    em.create(MultipartPart, { upload, partNumber: 2, etag: 'e2' });
    await em.flush();
    em.clear();

    await em.removeAndFlush(await em.findOneOrFail(MultipartUpload, { uploadId: 'u4' }));

    const conn = orm.em.getConnection();
    const [uploads] = await conn.execute<{ c: number }[]>(
      `select count(*) as c from multipart_uploads where upload_id = 'u4'`,
    );
    const [parts] = await conn.execute<{ c: number }[]>(
      `select count(*) as c from multipart_parts where upload_id = 'u4'`,
    );
    expect(Number(uploads.c)).toBe(0);
    expect(Number(parts.c)).toBe(0);
  });

  it('case 5: an absent checksumSha256 persists as NULL', async () => {
    await seedUpload('u5', 'mpb5');
    const em = orm.em.fork();
    const upload = await em.findOneOrFail(MultipartUpload, { uploadId: 'u5' });
    em.create(MultipartPart, { upload, partNumber: 1, etag: 'e' });
    await em.flush();
    em.clear();

    const read = await em.findOneOrFail(MultipartPart, { upload: { uploadId: 'u5' }, partNumber: 1 });
    expect(read.checksumSha256 ?? null).toBeNull();
  });
});
