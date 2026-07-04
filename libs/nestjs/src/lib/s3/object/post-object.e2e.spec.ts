import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { MikroORM, RequestContext } from '@mikro-orm/core';
import { getMikroORMToken } from '@mikro-orm/nestjs';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import request from 'supertest';

import { OpenBucketModule } from '../../open-bucket.module';
import { OpenBucketService } from '../../open-bucket.service';
import { Bucket } from '../../persistence/index';
import { OPEN_BUCKET_ORM_CONTEXT } from '../../persistence/orm-context';

/**
 * TEST-0802 (wire) — the full browser POST-policy upload path: SigV4 deferral +
 * PostObjectInterceptor auth + two-phase persistence + S3 success response.
 * Mounted at the ROOT so `POST /{bucket}` is the wire target.
 */
const DATA_DIR = join(process.cwd(), 'tmp', `ob-post-${process.pid}`);
const MOUNT = '/s3';
const ROOT = {
  accessKeyId: 'AKIAEXAMPLE000000000',
  secretAccessKey: 'k7Jf2pQrwStN9vB3zX1cM4dL0eR6yU2h7gK3nP5s',
};

describe('PostObject wire (TEST-0802)', () => {
  let app: INestApplication;
  let svc: OpenBucketService;

  beforeAll(async () => {
    rmSync(DATA_DIR, { recursive: true, force: true });
    mkdirSync(DATA_DIR, { recursive: true });
    const moduleRef = await Test.createTestingModule({
      imports: [OpenBucketModule.forRoot({ dataDir: DATA_DIR, mountPath: MOUNT, rootCredentials: ROOT })],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    svc = app.get(OpenBucketService);
    await svc.createBucket('uploads');
    await svc.createBucket('locked');
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    rmSync(DATA_DIR, { recursive: true, force: true });
  });

  function mint(bucket: string, extra: Record<string, unknown> = {}) {
    return svc.createPresignedPost(bucket, {
      key: 'users/${filename}',
      baseUrl: 'http://localhost',
      contentLengthRange: { min: 1, max: 5 * 1024 * 1024 },
      successActionStatus: '201',
      ...extra,
    });
  }

  async function postForm(
    bucket: string,
    fields: Record<string, string>,
    data: Buffer,
    filename = 'avatar.png',
  ) {
    let r = request(app.getHttpServer()).post(`${MOUNT}/${bucket}`);
    for (const [k, v] of Object.entries(fields)) r = r.field(k, v);
    return r.attach('file', data, filename); // file LAST, per S3
  }

  it('stores the object and returns 201 <PostResponse> with the ETag', async () => {
    const { fields } = mint('uploads');
    const res = await postForm('uploads', fields, Buffer.from('hello browser'));
    expect(res.status).toBe(201);
    expect(res.text).toContain('<PostResponse');
    expect(res.text).toContain('<Key>users/avatar.png</Key>');
    expect(res.headers['etag']).toBeTruthy();

    const meta = await svc.headObject('uploads', 'users/avatar.png');
    expect(meta).not.toBeNull();
    expect(meta!.size).toBe('hello browser'.length);
  });

  it('returns 204 when success_action_status is absent', async () => {
    const { fields } = svc.createPresignedPost('uploads', {
      key: 'plain/${filename}',
      baseUrl: 'http://localhost',
      contentLengthRange: { min: 1, max: 1024 },
    });
    const res = await postForm('uploads', fields, Buffer.from('x'), 'a.txt');
    expect(res.status).toBe(204);
    expect(await svc.headObject('uploads', 'plain/a.txt')).not.toBeNull();
  });

  it('rejects a mutated signature with 403 and writes nothing', async () => {
    const { fields } = mint('uploads');
    fields['x-amz-signature'] = fields['x-amz-signature'].replace(/.$/, (c) =>
      c === '0' ? '1' : '0',
    );
    const res = await postForm('uploads', fields, Buffer.from('evil'), 'evil.png');
    expect(res.status).toBe(403);
    expect(await svc.headObject('uploads', 'users/evil.png')).toBeNull();
  });

  it('honours an explicit Deny bucket policy (403)', async () => {
    const orm = app.get<MikroORM>(getMikroORMToken(OPEN_BUCKET_ORM_CONTEXT));
    await RequestContext.create(orm.em, async () => {
      const b = await orm.em.getRepository(Bucket).findOne({ name: 'locked' });
      b!.policy = {
        Version: '2012-10-17',
        Statement: [
          {
            Effect: 'Deny',
            Principal: '*',
            Action: 's3:PutObject',
            Resource: 'arn:aws:s3:::locked/*',
          },
        ],
      };
      await orm.em.flush();
    });

    const { fields } = mint('locked');
    const res = await postForm('locked', fields, Buffer.from('denied'), 'x.png');
    expect(res.status).toBe(403);
    expect(await svc.headObject('locked', 'users/x.png')).toBeNull();
  });
});
