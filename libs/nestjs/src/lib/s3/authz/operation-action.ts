/**
 * Map an S3 operation name (`req.openbucket.operation`, set by `@S3Operation`
 * via the OperationDispatcherInterceptor) to its IAM `s3:*` action name
 * (TASK-2120, finding [11]).
 *
 * Most operation names map 1:1 to their action (`GetObject` → `s3:GetObject`),
 * so only the divergences are listed below; everything else falls back to
 * `s3:<Operation>`. Returns `undefined` when the operation itself is unknown so
 * the caller can leave the request to the SigV4 credential check alone.
 */
const ACTION_OVERRIDES: Record<string, string> = {
  // Object reads that IAM folds under s3:GetObject.
  HeadObject: 's3:GetObject',
  // Object writes that IAM folds under s3:PutObject.
  CopyObject: 's3:PutObject',
  PostObject: 's3:PutObject',
  CreateMultipartUpload: 's3:PutObject',
  UploadPart: 's3:PutObject',
  UploadPartCopy: 's3:PutObject',
  CompleteMultipartUpload: 's3:PutObject',
  // Deletes.
  DeleteObjects: 's3:DeleteObject',
  // Bucket listings that IAM folds under s3:ListBucket.
  ListObjects: 's3:ListBucket',
  ListObjectsV2: 's3:ListBucket',
  HeadBucket: 's3:ListBucket',
  ListObjectVersions: 's3:ListBucketVersions',
  ListMultipartUploads: 's3:ListBucketMultipartUploads',
  ListParts: 's3:ListMultipartUploadParts',
  // Service scope.
  ListBuckets: 's3:ListAllMyBuckets',
};

export function operationToAction(operation: string | undefined): string | undefined {
  if (!operation) return undefined;
  return ACTION_OVERRIDES[operation] ?? `s3:${operation}`;
}
