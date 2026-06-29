import type { Request } from 'express';

/**
 * Resolves the S3 operation name from the request shape (verb + scope + query
 * flags + copy-source header), mirroring the per-verb query dispatch in the
 * Service/Bucket/Object controllers (§2.1 / §2.8.2).
 *
 * The controllers dispatch one handler per HTTP verb, so they can't carry a
 * single `@S3Operation` annotation; this table is the unified source of truth
 * that the `OperationDispatcherInterceptor` uses to set
 * `req.openbucket.operation` *before* the XmlInterceptor runs — which is what
 * gates inbound XML-body parsing (`XML_REQUEST_OPS`) and labels logs/metrics.
 *
 * Returns `undefined` when the shape doesn't correspond to a known operation
 * (e.g. a non-GET at service scope); callers leave `operation` unset.
 */
export function resolveS3Operation(req: Request): string | undefined {
  const scope = req.openbucket?.s3Scope;
  const method = req.method;
  const q = (req.query ?? {}) as Record<string, string | undefined>;
  const hasCopySource = req.headers['x-amz-copy-source'] !== undefined;

  switch (scope) {
    case 's3-service':
      return method === 'GET' ? 'ListBuckets' : undefined;
    case 's3-bucket':
      return resolveBucketOp(method, q);
    case 's3-object':
      return resolveObjectOp(method, q, hasCopySource);
    default:
      return undefined;
  }
}

/** Bucket-scope (`/:bucket`) dispatch — mirrors BucketController. */
function resolveBucketOp(method: string, q: Record<string, string | undefined>): string | undefined {
  const has = (k: string): boolean => k in q;
  switch (method) {
    case 'GET':
      if (has('versioning')) return 'GetBucketVersioning';
      if (has('cors')) return 'GetBucketCors';
      if (has('lifecycle')) return 'GetBucketLifecycleConfiguration';
      if (has('object-lock')) return 'GetObjectLockConfiguration';
      if (has('acl')) return 'GetBucketAcl';
      if (has('tagging')) return 'GetBucketTagging';
      if (has('policy')) return 'GetBucketPolicy';
      if (has('encryption')) return 'GetBucketEncryption';
      if (has('location')) return 'GetBucketLocation';
      if (has('replication')) return 'GetBucketReplication';
      if (has('notification')) return 'GetBucketNotificationConfiguration';
      if (has('accelerate')) return 'GetBucketAccelerateConfiguration';
      if (has('logging')) return 'GetBucketLogging';
      if (has('requestPayment')) return 'GetBucketRequestPayment';
      if (has('website')) return 'GetBucketWebsite';
      if (has('versions')) return 'ListObjectVersions';
      if (has('uploads')) return 'ListMultipartUploads';
      if (q['list-type'] === '2') return 'ListObjectsV2';
      return 'ListObjects';
    case 'PUT':
      if (has('versioning')) return 'PutBucketVersioning';
      if (has('cors')) return 'PutBucketCors';
      if (has('lifecycle')) return 'PutBucketLifecycleConfiguration';
      if (has('object-lock')) return 'PutObjectLockConfiguration';
      if (has('acl')) return 'PutBucketAcl';
      if (has('tagging')) return 'PutBucketTagging';
      if (has('policy')) return 'PutBucketPolicy';
      if (has('encryption')) return 'PutBucketEncryption';
      if (has('website')) return 'PutBucketWebsite';
      if (has('notification')) return 'PutBucketNotificationConfiguration';
      return 'CreateBucket';
    case 'POST':
      if (has('delete')) return 'DeleteObjects';
      return 'CreateBucket';
    case 'DELETE':
      if (has('cors')) return 'DeleteBucketCors';
      if (has('lifecycle')) return 'DeleteBucketLifecycle';
      if (has('tagging')) return 'DeleteBucketTagging';
      if (has('policy')) return 'DeleteBucketPolicy';
      if (has('encryption')) return 'DeleteBucketEncryption';
      return 'DeleteBucket';
    case 'HEAD':
      return 'HeadBucket';
    default:
      return undefined;
  }
}

/** Object-scope (`/:bucket/*`) dispatch — mirrors ObjectController. */
function resolveObjectOp(
  method: string,
  q: Record<string, string | undefined>,
  hasCopySource: boolean,
): string | undefined {
  const has = (k: string): boolean => k in q;
  switch (method) {
    case 'PUT':
      if (q.uploadId !== undefined && q.partNumber !== undefined) {
        return hasCopySource ? 'UploadPartCopy' : 'UploadPart';
      }
      if (has('tagging')) return 'PutObjectTagging';
      if (has('acl')) return 'PutObjectAcl';
      if (has('retention')) return 'PutObjectRetention';
      if (has('legal-hold')) return 'PutObjectLegalHold';
      if (hasCopySource) return 'CopyObject';
      return 'PutObject';
    case 'GET':
      if (has('tagging')) return 'GetObjectTagging';
      if (has('acl')) return 'GetObjectAcl';
      if (has('retention')) return 'GetObjectRetention';
      if (has('legal-hold')) return 'GetObjectLegalHold';
      if (has('attributes')) return 'GetObjectAttributes';
      if (has('torrent')) return 'GetObjectTorrent';
      if (q.uploadId !== undefined) return 'ListParts';
      return 'GetObject';
    case 'HEAD':
      return 'HeadObject';
    case 'POST':
      if (has('uploads')) return 'CreateMultipartUpload';
      if (q.uploadId !== undefined) return 'CompleteMultipartUpload';
      if (has('restore')) return 'RestoreObject';
      if (has('select')) return 'SelectObjectContent';
      return 'PostObject';
    case 'DELETE':
      if (q.uploadId !== undefined) return 'AbortMultipartUpload';
      if (has('tagging')) return 'DeleteObjectTagging';
      return 'DeleteObject';
    default:
      return undefined;
  }
}
