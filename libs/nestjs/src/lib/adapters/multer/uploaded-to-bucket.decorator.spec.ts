import type { ExecutionContext } from '@nestjs/common';

import { uploadedToBucketFactory, type UploadedFileInfo } from './uploaded-to-bucket.decorator';
import type { OpenBucketMulterInfo } from './open-bucket-storage';

function ctxWith(reqPatch: Record<string, unknown>): ExecutionContext {
  const req = reqPatch;
  return {
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
}

function committed(key: string): Express.Multer.File {
  const openBucket: OpenBucketMulterInfo = {
    bucket: 'uploads',
    key,
    etag: 'etag',
    size: 99,
    contentType: 'image/png',
    url: 'https://files.example.com/uploads/' + key,
    versionId: 'v1',
    image: { width: 1, height: 2, type: 'png' },
  };
  return { fieldname: 'file', originalname: key, openBucket } as unknown as Express.Multer.File;
}

describe('uploadedToBucketFactory (TASK-3601)', () => {
  it('maps a single req.file to a clean UploadedFileInfo', () => {
    const info = uploadedToBucketFactory(undefined, ctxWith({ file: committed('a.png') }));
    expect(info).toEqual<UploadedFileInfo>({
      bucket: 'uploads',
      key: 'a.png',
      etag: 'etag',
      size: 99,
      contentType: 'image/png',
      url: 'https://files.example.com/uploads/a.png',
      versionId: 'v1',
      image: { width: 1, height: 2, type: 'png' },
    });
  });

  it('maps a req.files array to UploadedFileInfo[]', () => {
    const info = uploadedToBucketFactory(
      undefined,
      ctxWith({ files: [committed('a.png'), committed('b.png')] }),
    );
    expect(Array.isArray(info)).toBe(true);
    expect((info as UploadedFileInfo[]).map((i) => i.key)).toEqual(['a.png', 'b.png']);
  });

  it('returns a specific field from a fields map when field is given', () => {
    const files = { avatar: [committed('av.png')], docs: [committed('d1'), committed('d2')] };
    const info = uploadedToBucketFactory('docs', ctxWith({ files }));
    expect((info as UploadedFileInfo[]).map((i) => i.key)).toEqual(['d1', 'd2']);
  });

  it('flattens all fields when no field arg is given', () => {
    const files = { avatar: [committed('av.png')], docs: [committed('d1')] };
    const info = uploadedToBucketFactory(undefined, ctxWith({ files }));
    expect((info as UploadedFileInfo[]).map((i) => i.key)).toEqual(['av.png', 'd1']);
  });

  it('returns undefined when nothing was uploaded (no throw)', () => {
    expect(uploadedToBucketFactory(undefined, ctxWith({}))).toBeUndefined();
  });

  it('degrades gracefully: a file from another storage engine (no openBucket) is dropped', () => {
    const foreign = { fieldname: 'x' } as unknown as Express.Multer.File;
    // single foreign file → undefined
    expect(uploadedToBucketFactory(undefined, ctxWith({ file: foreign }))).toBeUndefined();
    // mixed array → only the committed one survives
    const info = uploadedToBucketFactory(undefined, ctxWith({ files: [foreign, committed('ok')] }));
    expect((info as UploadedFileInfo[]).map((i) => i.key)).toEqual(['ok']);
  });

  it('omits optional fields when the engine did not set them', () => {
    const bare = {
      fieldname: 'file',
      openBucket: { bucket: 'b', key: 'k', etag: 'e', size: 5, contentType: 'text/plain' },
    } as unknown as Express.Multer.File;
    const info = uploadedToBucketFactory(undefined, ctxWith({ file: bare })) as UploadedFileInfo;
    expect(info).toEqual({ bucket: 'b', key: 'k', etag: 'e', size: 5, contentType: 'text/plain' });
    expect('url' in info).toBe(false);
    expect('image' in info).toBe(false);
  });
});
