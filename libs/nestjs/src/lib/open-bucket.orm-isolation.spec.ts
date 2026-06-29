import { Controller, Get, type INestApplication, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { MikroOrmModule, getMikroORMToken } from '@mikro-orm/nestjs';
import { BetterSqliteDriver, EntityManager } from '@mikro-orm/better-sqlite';
import { Entity, MikroORM, PrimaryKey, Property } from '@mikro-orm/core';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import request from 'supertest';

import { OpenBucketModule } from './open-bucket.module';
import { OPEN_BUCKET_ORM_CONTEXT } from './persistence/orm-context';

/**
 * Phase-5 isolation proof: a host app that ALSO uses MikroORM (under the
 * default, unnamed context) embeds `OpenBucketModule.forRoot`. OpenBucket runs
 * its own MikroORM under the `openbucket` context, so the two never collide on
 * the default `MikroORM` / `EntityManager` DI tokens.
 *
 * Asserts: (1) the default `MikroORM` token resolves to the HOST's ORM, not
 * OpenBucket's (no token collision); (2) the host's own default-context ORM
 * works; (3) OpenBucket's named ORM boots and serves the S3 wire protocol under
 * the mount; (4) an authenticated admin call under the mount goes through
 * BucketService — which reads via the request-scoped EM — and returns 200,
 * proving OrmContextMiddleware opens the per-request context for the named ORM
 * (and that the admin routes + classifier are mount-aware).
 */

// The host app's OWN entity, in the DEFAULT (unnamed) MikroORM context.
@Entity({ tableName: 'host_things' })
class HostThing {
  @PrimaryKey({ type: 'string' })
  id!: string;

  @Property({ type: 'string' })
  name!: string;
}

@Controller('host')
class HostOrmController {
  constructor(private readonly em: EntityManager) {}

  @Get('db-thing')
  async dbThing(): Promise<{ name: string }> {
    const em = this.em.fork();
    em.create(HostThing, { id: 'h1', name: 'from-host-orm' });
    await em.flush();
    em.clear();
    const row = await em.findOneOrFail(HostThing, { id: 'h1' });
    return { name: row.name };
  }
}

@Module({
  imports: [
    MikroOrmModule.forRoot({
      driver: BetterSqliteDriver,
      dbName: ':memory:',
      entities: [HostThing],
      allowGlobalContext: true,
    }),
    MikroOrmModule.forFeature([HostThing]),
  ],
  controllers: [HostOrmController],
})
class HostWithOwnOrmModule {}

const DATA_DIR = join(process.cwd(), 'tmp', `ob-orm-iso-${process.pid}`);
const JWT_SECRET = 'x'.repeat(40);

describe('OpenBucketModule.forRoot — MikroORM context isolation (phase 5)', () => {
  let app: INestApplication;
  let token: string;

  beforeAll(async () => {
    rmSync(DATA_DIR, { recursive: true, force: true });
    mkdirSync(DATA_DIR, { recursive: true });

    const moduleRef = await Test.createTestingModule({
      imports: [
        HostWithOwnOrmModule,
        OpenBucketModule.forRoot({
          dataDir: DATA_DIR,
          rootCredentials: { accessKeyId: 'AKIAEXAMPLE000000000', secretAccessKey: 'x'.repeat(40) },
          admin: {
            username: 'admin',
            passwordHash: '$argon2id$v=19$m=65536,t=3,p=4$abc$def',
            jwtSecret: JWT_SECRET,
          },
        }),
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();

    // The host owns the default context; create its schema (no migrations).
    const hostOrm = app.get(MikroORM);
    await hostOrm.schema.createSchema();

    // A valid admin access token (matches JwtStrategy: issuer/audience/secret).
    token = new JwtService().sign(
      { sub: 'admin', username: 'admin', mustChangePassword: false },
      { secret: JWT_SECRET, issuer: 'openbucket', audience: 'openbucket-admin', expiresIn: '5m' },
    );
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    rmSync(DATA_DIR, { recursive: true, force: true });
  });

  it('the default MikroORM token resolves to the HOST ORM, not OpenBucket', () => {
    const hostOrm = app.get(MikroORM);
    const obOrm = app.get<MikroORM>(getMikroORMToken(OPEN_BUCKET_ORM_CONTEXT));
    expect(hostOrm).toBeDefined();
    expect(obOrm).toBeDefined();
    expect(hostOrm).not.toBe(obOrm);
  });

  it("the host's own (default-context) ORM works alongside OpenBucket", async () => {
    const res = await request(app.getHttpServer()).get('/host/db-thing');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ name: 'from-host-orm' });
  });

  it('OpenBucket boots its named ORM (S3 wire protocol responds under the mount)', async () => {
    const res = await request(app.getHttpServer()).get('/storage/');
    expect(res.status).toBe(403);
    expect(res.headers['content-type']).toContain('xml');
  });

  it('an authenticated admin call uses the request-scoped named EM (200)', async () => {
    // GET /buckets → BucketService.listWithStats(), which reads through the
    // request-scoped EM. A 200 proves OrmContextMiddleware opened the per-request
    // context for the named ORM (allowGlobalContext is false — no context = throw),
    // and that the mounted admin route classifies/routes correctly (else the SigV4
    // guard 403s the Bearer, or the S3 controller 404s the path).
    const res = await request(app.getHttpServer())
      .get('/storage/api/admin/buckets')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.buckets)).toBe(true);
  });
});
