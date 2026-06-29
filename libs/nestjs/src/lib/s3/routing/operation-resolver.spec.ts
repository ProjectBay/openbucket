import type { Request } from 'express';

import { resolveS3Operation } from './operation-resolver';

/**
 * TEST — resolveS3Operation dispatch table. Mirrors the per-verb query dispatch
 * in the Service/Bucket/Object controllers; the global
 * OperationDispatcherInterceptor relies on it to set req.openbucket.operation
 * before XmlInterceptor's inbound XML-body gate.
 */
function req(
  method: string,
  s3Scope: 's3-service' | 's3-bucket' | 's3-object',
  query: Record<string, string | undefined> = {},
  headers: Record<string, string> = {},
): Request {
  return {
    method,
    query,
    headers,
    openbucket: { requestId: 'r', kind: 's3', receivedAt: 0, s3Scope },
  } as unknown as Request;
}

describe('resolveS3Operation', () => {
  it('service scope: GET / → ListBuckets; other verbs → undefined', () => {
    expect(resolveS3Operation(req('GET', 's3-service'))).toBe('ListBuckets');
    expect(resolveS3Operation(req('POST', 's3-service'))).toBeUndefined();
  });

  it('bucket scope: listing + CRUD + sub-resources', () => {
    expect(resolveS3Operation(req('GET', 's3-bucket'))).toBe('ListObjects');
    expect(resolveS3Operation(req('GET', 's3-bucket', { 'list-type': '2' }))).toBe('ListObjectsV2');
    expect(resolveS3Operation(req('GET', 's3-bucket', { versions: '' }))).toBe('ListObjectVersions');
    expect(resolveS3Operation(req('GET', 's3-bucket', { uploads: '' }))).toBe(
      'ListMultipartUploads',
    );
    expect(resolveS3Operation(req('GET', 's3-bucket', { tagging: '' }))).toBe('GetBucketTagging');
    expect(resolveS3Operation(req('PUT', 's3-bucket'))).toBe('CreateBucket');
    expect(resolveS3Operation(req('PUT', 's3-bucket', { versioning: '' }))).toBe(
      'PutBucketVersioning',
    );
    expect(resolveS3Operation(req('POST', 's3-bucket', { delete: '' }))).toBe('DeleteObjects');
    expect(resolveS3Operation(req('DELETE', 's3-bucket'))).toBe('DeleteBucket');
    expect(resolveS3Operation(req('DELETE', 's3-bucket', { tagging: '' }))).toBe(
      'DeleteBucketTagging',
    );
    expect(resolveS3Operation(req('HEAD', 's3-bucket'))).toBe('HeadBucket');
  });

  it('object scope: object CRUD, multipart, and copy variants', () => {
    expect(resolveS3Operation(req('PUT', 's3-object'))).toBe('PutObject');
    expect(resolveS3Operation(req('PUT', 's3-object', {}, { 'x-amz-copy-source': 's/k' }))).toBe(
      'CopyObject',
    );
    expect(resolveS3Operation(req('PUT', 's3-object', { uploadId: 'u', partNumber: '1' }))).toBe(
      'UploadPart',
    );
    expect(
      resolveS3Operation(
        req('PUT', 's3-object', { uploadId: 'u', partNumber: '1' }, { 'x-amz-copy-source': 's/k' }),
      ),
    ).toBe('UploadPartCopy');
    expect(resolveS3Operation(req('PUT', 's3-object', { tagging: '' }))).toBe('PutObjectTagging');
    expect(resolveS3Operation(req('GET', 's3-object'))).toBe('GetObject');
    expect(resolveS3Operation(req('GET', 's3-object', { uploadId: 'u' }))).toBe('ListParts');
    expect(resolveS3Operation(req('GET', 's3-object', { attributes: '' }))).toBe(
      'GetObjectAttributes',
    );
    expect(resolveS3Operation(req('HEAD', 's3-object'))).toBe('HeadObject');
    expect(resolveS3Operation(req('POST', 's3-object', { uploads: '' }))).toBe(
      'CreateMultipartUpload',
    );
    expect(resolveS3Operation(req('POST', 's3-object', { uploadId: 'u' }))).toBe(
      'CompleteMultipartUpload',
    );
    expect(resolveS3Operation(req('DELETE', 's3-object', { uploadId: 'u' }))).toBe(
      'AbortMultipartUpload',
    );
    expect(resolveS3Operation(req('DELETE', 's3-object'))).toBe('DeleteObject');
  });

  it('returns undefined when scope is absent (non-S3 request)', () => {
    const r = { method: 'GET', query: {}, headers: {}, openbucket: { kind: 'admin' } };
    expect(resolveS3Operation(r as unknown as Request)).toBeUndefined();
  });
});
