import { Readable } from 'node:stream';
import type { Request } from 'express';

import { openBucketStorage } from './open-bucket-storage';
import { resolveKey, UploadValidationError } from '../../open-bucket-upload';
import type { OpenBucketService, UploadOptions, UploadResult } from '../../open-bucket.service';

/** A minimal fake OpenBucketService recording the last uploadFrom/deleteObject call. */
function fakeOb(overrides: Partial<Record<'uploadFrom' | 'deleteObject', jest.Mock>> = {}) {
  const lastUpload: { source?: unknown; opts?: UploadOptions } = {};
  const uploadFrom =
    overrides.uploadFrom ??
    jest.fn(async (source: unknown, opts: UploadOptions): Promise<UploadResult> => {
      lastUpload.source = source;
      lastUpload.opts = opts;
      return {
        bucket: opts.bucket,
        key: 'resolved/key.png',
        etag: 'etag-1',
        size: 123,
        contentType: 'image/png',
        url: 'https://files.example.com/uploads/resolved/key.png',
        versionId: 'v1',
        image: { width: 10, height: 20, type: 'png' },
      };
    });
  const deleteObject = overrides.deleteObject ?? jest.fn(async () => undefined);
  return {
    ob: { uploadFrom, deleteObject } as unknown as OpenBucketService,
    uploadFrom,
    deleteObject,
    lastUpload,
  };
}

function fakeFile(overrides: Partial<Express.Multer.File> = {}): Express.Multer.File {
  return {
    fieldname: 'file',
    originalname: 'photo.png',
    mimetype: 'image/png',
    stream: Readable.from(Buffer.from('data')),
    ...overrides,
  } as Express.Multer.File;
}

const req = {} as Request;

describe('openBucketStorage (TASK-3600)', () => {
  it('returns a structural StorageEngine with callable _handleFile/_removeFile', () => {
    const { ob } = fakeOb();
    const engine = openBucketStorage(ob, { bucket: 'x' });
    expect(typeof engine._handleFile).toBe('function');
    expect(typeof engine._removeFile).toBe('function');
  });

  it('streams file.stream through uploadFrom and merges the result onto the file', (done) => {
    const { ob, uploadFrom, lastUpload } = fakeOb();
    const engine = openBucketStorage(ob, { bucket: 'uploads', image: true });
    const file = fakeFile();

    engine._handleFile(req, file, (err, info) => {
      try {
        expect(err).toBeFalsy();
        expect(uploadFrom).toHaveBeenCalledTimes(1);
        // The busboy part stream is passed straight through — no buffer/temp file.
        expect(lastUpload.source).toBe(file.stream);
        expect(lastUpload.opts?.bucket).toBe('uploads');
        expect(lastUpload.opts?.contentType).toBe('image/png');
        expect(lastUpload.opts?.filename).toBe('photo.png');
        expect(lastUpload.opts?.image).toBe(true);
        // Merged shape: size at top level + a full openBucket payload.
        expect(info?.size).toBe(123);
        expect((info as { openBucket?: unknown }).openBucket).toEqual({
          bucket: 'uploads',
          key: 'resolved/key.png',
          etag: 'etag-1',
          size: 123,
          contentType: 'image/png',
          url: 'https://files.example.com/uploads/resolved/key.png',
          versionId: 'v1',
          image: { width: 10, height: 20, type: 'png' },
        });
        done();
      } catch (e) {
        done(e as Error);
      }
    });
  });

  it('maps a built-in key name to keyStrategy (never the explicit key)', (done) => {
    const { ob, lastUpload } = fakeOb();
    const engine = openBucketStorage(ob, { bucket: 'x', key: 'sha256' });
    engine._handleFile(req, fakeFile(), () => {
      try {
        expect(lastUpload.opts?.key).toBeUndefined();
        expect(lastUpload.opts?.keyStrategy).toBe('sha256');
        done();
      } catch (e) {
        done(e as Error);
      }
    });
  });

  it('routes a per-request key function through keyStrategy so assertSafeKey guards it', (done) => {
    const { ob, lastUpload } = fakeOb();
    // A caller-derived key that attempts path traversal.
    const engine = openBucketStorage(ob, { bucket: 'x', key: () => '../evil' });
    engine._handleFile(req, fakeFile(), () => {
      try {
        // Never handed as the explicit (unsanitized) key.
        expect(lastUpload.opts?.key).toBeUndefined();
        const strategy = lastUpload.opts?.keyStrategy;
        expect(typeof strategy).toBe('function');
        // uploadFrom runs the strategy through assertSafeKey → traversal rejected.
        expect(() =>
          resolveKey(strategy as (ctx: never) => string, {
            contentType: 'text/plain',
            ext: '',
          } as never),
        ).toThrow(UploadValidationError);
        done();
      } catch (e) {
        done(e as Error);
      }
    });
  });

  it('awaits an async per-request key function before uploading', (done) => {
    const { ob, lastUpload } = fakeOb();
    const engine = openBucketStorage(ob, {
      bucket: 'x',
      key: async () => 'tenant-42/file.png',
    });
    engine._handleFile(req, fakeFile(), () => {
      try {
        const strategy = lastUpload.opts?.keyStrategy as (ctx: never) => string;
        expect(strategy({} as never)).toBe('tenant-42/file.png');
        done();
      } catch (e) {
        done(e as Error);
      }
    });
  });

  it('resolves per-request bucket/validate functions', (done) => {
    const { ob, lastUpload } = fakeOb();
    const engine = openBucketStorage(ob, {
      bucket: () => 'derived-bucket',
      validate: () => ({ maxBytes: 42 }),
    });
    engine._handleFile(req, fakeFile(), () => {
      try {
        expect(lastUpload.opts?.bucket).toBe('derived-bucket');
        expect(lastUpload.opts?.validate).toEqual({ maxBytes: 42 });
        done();
      } catch (e) {
        done(e as Error);
      }
    });
  });

  it('forwards an uploadFrom rejection to cb and drains the part stream', (done) => {
    const err = new UploadValidationError('too big', 'too_large');
    const uploadFrom = jest.fn(async () => {
      throw err;
    });
    const { ob } = fakeOb({ uploadFrom });
    const engine = openBucketStorage(ob, { bucket: 'x' });
    const stream = Readable.from(Buffer.from('data'));
    const resume = jest.spyOn(stream, 'resume');
    const file = fakeFile({ stream });

    engine._handleFile(req, file, (cbErr) => {
      try {
        expect(cbErr).toBe(err);
        expect(resume).toHaveBeenCalled();
        done();
      } catch (e) {
        done(e as Error);
      }
    });
  });

  it('cbs a TypeError when attached to a field with no stream (misuse)', (done) => {
    const { ob, uploadFrom } = fakeOb();
    const engine = openBucketStorage(ob, { bucket: 'x' });
    const file = fakeFile({ stream: undefined });
    engine._handleFile(req, file, (cbErr) => {
      try {
        expect(cbErr).toBeInstanceOf(TypeError);
        expect(uploadFrom).not.toHaveBeenCalled();
        done();
      } catch (e) {
        done(e as Error);
      }
    });
  });
});

describe('openBucketStorage._removeFile (rollback, TASK-3600)', () => {
  it('deletes a committed object', (done) => {
    const { ob, deleteObject } = fakeOb();
    const engine = openBucketStorage(ob, { bucket: 'x' });
    const file = fakeFile();
    file.openBucket = {
      bucket: 'uploads',
      key: 'resolved/key.png',
      etag: 'e',
      size: 1,
      contentType: 'image/png',
    };
    engine._removeFile(req, file, (err) => {
      try {
        expect(err).toBeNull();
        expect(deleteObject).toHaveBeenCalledWith('uploads', 'resolved/key.png');
        done();
      } catch (e) {
        done(e as Error);
      }
    });
  });

  it('is a no-op for a never-committed file', (done) => {
    const { ob, deleteObject } = fakeOb();
    const engine = openBucketStorage(ob, { bucket: 'x' });
    engine._removeFile(req, fakeFile(), (err) => {
      try {
        expect(err).toBeNull();
        expect(deleteObject).not.toHaveBeenCalled();
        done();
      } catch (e) {
        done(e as Error);
      }
    });
  });

  it('forwards a delete failure to cb', (done) => {
    const boom = new Error('boom');
    const deleteObject = jest.fn(async () => {
      throw boom;
    });
    const { ob } = fakeOb({ deleteObject });
    const engine = openBucketStorage(ob, { bucket: 'x' });
    const file = fakeFile();
    file.openBucket = {
      bucket: 'uploads',
      key: 'k',
      etag: 'e',
      size: 1,
      contentType: 'image/png',
    };
    engine._removeFile(req, file, (err) => {
      try {
        expect(err).toBe(boom);
        done();
      } catch (e) {
        done(e as Error);
      }
    });
  });
});
