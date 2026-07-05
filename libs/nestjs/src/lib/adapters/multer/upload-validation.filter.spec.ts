import type { ArgumentsHost } from '@nestjs/common';

import { UploadValidationExceptionFilter } from './upload-validation.filter';
import { UploadValidationError } from '../../open-bucket-upload';

function fakeHost() {
  const res = {
    statusCode: 0,
    body: undefined as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
  };
  const host = {
    switchToHttp: () => ({ getResponse: () => res }),
  } as unknown as ArgumentsHost;
  return { host, res };
}

describe('UploadValidationExceptionFilter (TASK-3602)', () => {
  it('maps an UploadValidationError to a 400 with a stable { code, message } body', () => {
    const filter = new UploadValidationExceptionFilter();
    const { host, res } = fakeHost();
    filter.catch(new UploadValidationError('object is 999 bytes, over the limit', 'too_large'), host);

    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({
      statusCode: 400,
      error: 'Bad Request',
      code: 'too_large',
      message: 'object is 999 bytes, over the limit',
    });
  });

  it('carries the exact code union through for each rejection kind', () => {
    const filter = new UploadValidationExceptionFilter();
    for (const code of [
      'too_large',
      'active_content',
      'type_not_allowed',
      'no_content_type',
      'invalid_key',
    ] as const) {
      const { host, res } = fakeHost();
      filter.catch(new UploadValidationError('m', code), host);
      expect((res.body as { code: string }).code).toBe(code);
    }
  });

  it('never leaks a request header / credential — body is exactly the four safe fields', () => {
    const filter = new UploadValidationExceptionFilter();
    const { host, res } = fakeHost();
    filter.catch(new UploadValidationError("content type 'text/html' not allowed", 'type_not_allowed'), host);
    expect(Object.keys(res.body as object).sort()).toEqual([
      'code',
      'error',
      'message',
      'statusCode',
    ]);
  });
});
