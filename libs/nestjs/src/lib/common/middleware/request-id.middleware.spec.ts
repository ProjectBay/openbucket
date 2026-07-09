import type { Server } from 'node:http';

import express, { type Request, type Response } from 'express';
import request from 'supertest';

import { RequestIdMiddleware } from './request-id.middleware';

/**
 * TEST-0006 — request-id middleware assignment and propagation.
 */
const UUID_V7 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe('RequestIdMiddleware', () => {
  // One express app + one persistent ephemeral server for the whole suite,
  // matching every other supertest spec in the lib (they all listen once in
  // beforeAll). The middleware is stateless — each request still mints a fresh
  // id — so there is no per-test state to reset. Passing a fresh `express()`
  // app to supertest per test makes it stand up AND tear down a brand-new
  // ephemeral server for every request; under full-suite CPU saturation that
  // rapid listen/connect/close churn intermittently surfaced as a client-side
  // "socket hang up", the sole source of this suite's flakiness (TEST-0006).
  let server: Server;

  beforeAll((done) => {
    const mw = new RequestIdMiddleware();
    const app = express();
    app.use((req: Request, res: Response, next) => mw.use(req, res, next));
    app.get('/probe', (req: Request, res: Response) => {
      res.json({ openbucket: req.openbucket });
    });
    server = app.listen(0, done);
  });

  afterAll((done) => {
    server.close(done);
  });

  it('case 1: mints a UUIDv7 and sets both response headers', async () => {
    const res = await request(server).get('/probe');

    expect(res.status).toBe(200);
    const id = res.body.openbucket.requestId;
    expect(id).toMatch(UUID_V7);
    expect(res.headers['x-request-id']).toBe(id);
    expect(res.headers['x-amz-request-id']).toBe(id);
  });

  it('case 2: reuses a syntactically valid upstream X-Request-Id', async () => {
    const upstream = '0190d9c1-7f32-7c0c-bea5-1f51d1c0b2c4';
    const res = await request(server).get('/probe').set('X-Request-Id', upstream);

    expect(res.body.openbucket.requestId).toBe(upstream);
    expect(res.headers['x-request-id']).toBe(upstream);
  });

  it('case 3: discards a malformed upstream X-Request-Id and mints fresh', async () => {
    const res = await request(server).get('/probe').set('X-Request-Id', 'not-a-uuid');

    expect(res.body.openbucket.requestId).not.toBe('not-a-uuid');
    expect(res.body.openbucket.requestId).toMatch(UUID_V7);
  });

  it('case 4: initializes the placeholder context (kind=s3, receivedAt=0)', async () => {
    const res = await request(server).get('/probe');

    expect(res.body.openbucket.kind).toBe('s3');
    expect(res.body.openbucket.receivedAt).toBe(0);
  });
});
