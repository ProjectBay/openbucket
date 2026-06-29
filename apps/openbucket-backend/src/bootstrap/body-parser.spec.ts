import express, { type Express, type Request, type Response } from 'express';
import request from 'supertest';

import { configureBodyParsers } from './body-parser';

/**
 * TEST-0003 — body parsing scope (admin only).
 * Verifies parsers fire on /api/admin/* and that other routes stay raw.
 */
describe('configureBodyParsers', () => {
  let app: Express;

  beforeEach(() => {
    app = express();
    configureBodyParsers(app);

    app.post('/api/admin/echo', (req: Request, res: Response) => {
      res.json({ body: req.body });
    });

    app.post('/api/admin/form', (req: Request, res: Response) => {
      res.json({ body: req.body });
    });

    // No body parser should apply here — consume req as a raw stream.
    app.post('/s3-echo', (req: Request, res: Response) => {
      let bytes = 0;
      req.on('data', (chunk: Buffer) => {
        bytes += chunk.length;
      });
      req.on('end', () => {
        res.json({ bodyDefined: req.body !== undefined, bytes });
      });
    });
  });

  it('case 1: parses JSON on /api/admin/echo', async () => {
    const res = await request(app)
      .post('/api/admin/echo')
      .set('Content-Type', 'application/json')
      .send({ a: 1 });

    expect(res.status).toBe(200);
    expect(res.body.body.a).toBe(1);
  });

  it('case 2: rejects oversized admin JSON with 413', async () => {
    const big = JSON.stringify({ blob: 'x'.repeat(2 * 1024 * 1024) }); // ~2 MiB
    const res = await request(app)
      .post('/api/admin/echo')
      .set('Content-Type', 'application/json')
      .send(big);

    expect(res.status).toBe(413);
  });

  it('case 3: leaves /s3-echo body raw and streamable', async () => {
    const payload = Buffer.alloc(1024 * 1024, 0x61); // 1 MiB of 'a'
    const res = await request(app)
      .post('/s3-echo')
      .set('Content-Type', 'application/octet-stream')
      .send(payload);

    expect(res.status).toBe(200);
    expect(res.body.bodyDefined).toBe(false);
    expect(res.body.bytes).toBe(1024 * 1024);
  });

  it('case 4: parses url-encoded form on /api/admin/form', async () => {
    const res = await request(app)
      .post('/api/admin/form')
      .set('Content-Type', 'application/x-www-form-urlencoded')
      .send('k=v');

    expect(res.status).toBe(200);
    expect(res.body.body.k).toBe('v');
  });
});
