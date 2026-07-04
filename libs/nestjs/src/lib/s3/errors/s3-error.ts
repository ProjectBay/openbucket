/**
 * S3 error taxonomy — WHITEPAPER §2.6.
 *
 * All errors thrown inside the S3 controller tree extend `S3Error`. The base
 * class captures the four pieces of an AWS error: code, message, HTTP status,
 * and a place for the resource and request id to be injected by the filter
 * (STORY-0106). Optional AWS-specific fields go in `extra` and are rendered as
 * child elements of `<Error>`.
 *
 * Code strings and default messages are verbatim from §2.6 — AWS clients match
 * on these, so they must not be paraphrased.
 */
export abstract class S3Error extends Error {
  abstract readonly code: string;
  abstract readonly httpStatus: number;
  resource?: string;
  requestId?: string;

  /** Optional AWS-specific extra fields (rendered as elements). */
  extra: Record<string, string | number | undefined> = {};

  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
  }
}

// -- 400 --------------------------------------------------------------
export class InvalidBucketNameError extends S3Error {
  readonly code = 'InvalidBucketName';
  readonly httpStatus = 400;
  constructor(bucket: string) {
    super(`The specified bucket is not valid: ${bucket}`);
    this.extra.BucketName = bucket;
  }
}
export class InvalidArgumentError extends S3Error {
  readonly code = 'InvalidArgument';
  readonly httpStatus = 400;
  constructor(message: string, argName?: string, argValue?: string) {
    super(message);
    if (argName !== undefined) this.extra.ArgumentName = argName;
    if (argValue !== undefined) this.extra.ArgumentValue = argValue;
  }
}
/**
 * 400 KeyTooLongError — the object key exceeds S3's 1024-byte limit. Enforced
 * once at the shared routing seam (`RouteResolver.resolve`) so PUT/GET/DELETE/LIST
 * share it, converting an over-length key into a deterministic 400 instead of
 * letting it reach `fs.mkdir` and surface as an opaque `ENAMETOOLONG` 500
 * (TASK-2160, CWE-770). Distinct from the per-segment `KeyTooLongError` in
 * `storage/key-codec.ts`, which guards the 255-byte-per-segment filesystem cap.
 */
export class KeyTooLongError extends S3Error {
  readonly code = 'KeyTooLongError';
  readonly httpStatus = 400;
  constructor(byteLength?: number) {
    super('Your key is too long.');
    if (byteLength !== undefined) this.extra.Size = byteLength;
    this.extra.MaxSizeAllowed = 1024;
  }
}
export class MalformedXMLError extends S3Error {
  readonly code = 'MalformedXML';
  readonly httpStatus = 400;
  constructor(detail = 'The XML you provided was not well-formed') {
    super(detail);
  }
}
export class MalformedPolicyError extends S3Error {
  readonly code = 'MalformedPolicy';
  readonly httpStatus = 400;
  constructor(detail = 'This policy contains invalid Json') {
    super(detail);
  }
}
export class InvalidPartError extends S3Error {
  readonly code = 'InvalidPart';
  readonly httpStatus = 400;
  constructor(partNumber?: number) {
    super('One or more of the specified parts could not be found.');
    if (partNumber !== undefined) this.extra.PartNumber = partNumber;
  }
}
export class InvalidPartOrderError extends S3Error {
  readonly code = 'InvalidPartOrder';
  readonly httpStatus = 400;
  constructor() {
    super('The list of parts was not in ascending order.');
  }
}
export class InvalidRequestError extends S3Error {
  readonly code = 'InvalidRequest';
  readonly httpStatus = 400;
}
/**
 * 400 MalformedPOSTRequest — the browser `multipart/form-data` POST body could
 * not be parsed as a valid S3 POST upload (STORY-0802): missing/ordered form
 * parts, too many parts/fields, or an over-large field. AWS returns this for a
 * malformed presigned-POST form submission.
 */
export class MalformedPOSTRequestError extends S3Error {
  readonly code = 'MalformedPOSTRequest';
  readonly httpStatus = 400;
  constructor(detail = 'The body of your POST request is not well-formed multipart/form-data.') {
    super(detail);
  }
}
export class EntityTooSmallError extends S3Error {
  readonly code = 'EntityTooSmall';
  readonly httpStatus = 400;
  constructor() {
    super('Your proposed upload is smaller than the minimum allowed object size.');
  }
}
export class IncompleteBodyError extends S3Error {
  readonly code = 'IncompleteBody';
  readonly httpStatus = 400;
}
export class MissingContentLengthError extends S3Error {
  readonly code = 'MissingContentLength';
  readonly httpStatus = 411;
}
/**
 * 400 BadDigest — the body's MD5 disagrees with the client's `Content-MD5`.
 * Not enumerated in §2.6's list but part of the S3 wire surface; used by the
 * PutObject/UploadPart streaming verifier (STORY-0301).
 */
export class BadDigestError extends S3Error {
  readonly code = 'BadDigest';
  readonly httpStatus = 400;
  constructor() {
    super('The Content-MD5 you specified did not match what we received.');
  }
}
/** 400 XAmzContentSHA256Mismatch — body sha256 disagrees with the signed header. */
export class XAmzContentSHA256MismatchError extends S3Error {
  readonly code = 'XAmzContentSHA256Mismatch';
  readonly httpStatus = 400;
  constructor() {
    super("The provided 'x-amz-content-sha256' header does not match what was computed.");
  }
}
export class RequestTimeTooSkewedError extends S3Error {
  readonly code = 'RequestTimeTooSkewed';
  readonly httpStatus = 403;
  constructor(serverTime: number) {
    super('The difference between the request time and the current time is too large.');
    this.extra.ServerTime = new Date(serverTime).toISOString();
    this.extra.RequestTime = new Date().toISOString();
  }
}

// -- 403 --------------------------------------------------------------
export class AccessDeniedError extends S3Error {
  readonly code = 'AccessDenied';
  readonly httpStatus = 403;
  constructor(message = 'Access Denied') {
    super(message);
  }
}
export class SignatureDoesNotMatchError extends S3Error {
  readonly code = 'SignatureDoesNotMatch';
  readonly httpStatus = 403;
  constructor() {
    super(
      'The request signature we calculated does not match the signature you provided. ' +
        'Check your key and signing method.',
    );
  }
}

// -- 404 --------------------------------------------------------------
export class NoSuchBucketError extends S3Error {
  readonly code = 'NoSuchBucket';
  readonly httpStatus = 404;
  constructor(bucket: string) {
    super('The specified bucket does not exist');
    this.extra.BucketName = bucket;
  }
}
export class NoSuchKeyError extends S3Error {
  readonly code = 'NoSuchKey';
  readonly httpStatus = 404;
  constructor(key: string) {
    super('The specified key does not exist.');
    this.extra.Key = key;
  }
}
export class NoSuchUploadError extends S3Error {
  readonly code = 'NoSuchUpload';
  readonly httpStatus = 404;
  constructor() {
    super('The specified multipart upload does not exist.');
  }
}
export class NoSuchVersionError extends S3Error {
  readonly code = 'NoSuchVersion';
  readonly httpStatus = 404;
}
export class NoSuchCORSConfigurationError extends S3Error {
  readonly code = 'NoSuchCORSConfiguration';
  readonly httpStatus = 404;
}
export class NoSuchLifecycleConfigurationError extends S3Error {
  readonly code = 'NoSuchLifecycleConfiguration';
  readonly httpStatus = 404;
}
export class NoSuchBucketPolicyError extends S3Error {
  readonly code = 'NoSuchBucketPolicy';
  readonly httpStatus = 404;
}
export class NoSuchTagSetError extends S3Error {
  readonly code = 'NoSuchTagSet';
  readonly httpStatus = 404;
}
/** 404 for `GET /:bucket?encryption` when no default encryption is configured. */
export class ServerSideEncryptionConfigurationNotFoundError extends S3Error {
  readonly code = 'ServerSideEncryptionConfigurationNotFoundError';
  readonly httpStatus = 404;
  constructor(detail = 'The server side encryption configuration was not found') {
    super(detail);
  }
}
/** 404 for `GET /:bucket?object-lock` when the bucket never had object lock enabled. */
export class ObjectLockConfigurationNotFoundError extends S3Error {
  readonly code = 'ObjectLockConfigurationNotFoundError';
  readonly httpStatus = 404;
  constructor(detail = 'Object Lock configuration does not exist for this bucket') {
    super(detail);
  }
}
/** 404 for `GET /:bucket/:key?retention` when the object has no retention set. */
export class NoSuchObjectLockConfigurationError extends S3Error {
  readonly code = 'NoSuchObjectLockConfiguration';
  readonly httpStatus = 404;
  constructor(detail = 'The specified object does not have an ObjectLock configuration') {
    super(detail);
  }
}

// -- 409 --------------------------------------------------------------
export class BucketAlreadyExistsError extends S3Error {
  readonly code = 'BucketAlreadyExists';
  readonly httpStatus = 409;
}
export class BucketAlreadyOwnedByYouError extends S3Error {
  readonly code = 'BucketAlreadyOwnedByYou';
  readonly httpStatus = 409;
}
export class BucketNotEmptyError extends S3Error {
  readonly code = 'BucketNotEmpty';
  readonly httpStatus = 409;
}
export class InvalidBucketStateError extends S3Error {
  readonly code = 'InvalidBucketState';
  readonly httpStatus = 409;
}
export class OperationAbortedError extends S3Error {
  readonly code = 'OperationAborted';
  readonly httpStatus = 409;
}

// -- 412 --------------------------------------------------------------
export class PreconditionFailedError extends S3Error {
  readonly code = 'PreconditionFailed';
  readonly httpStatus = 412;
}

// -- 413 / 416 --------------------------------------------------------
export class EntityTooLargeError extends S3Error {
  readonly code = 'EntityTooLarge';
  readonly httpStatus = 413;
  constructor(proposed: number, max: number) {
    super('Your proposed upload exceeds the maximum allowed object size.');
    this.extra.ProposedSize = proposed;
    this.extra.MaxSizeAllowed = max;
  }
}
export class InvalidRangeError extends S3Error {
  readonly code = 'InvalidRange';
  readonly httpStatus = 416;
}

// -- 501 --------------------------------------------------------------
export class NotImplementedError extends S3Error {
  readonly code = 'NotImplemented';
  readonly httpStatus = 501;
  constructor(op: string) {
    super(`The ${op} operation is not implemented by OpenBucket.`);
    this.extra.Operation = op;
  }
}

// -- 507 --------------------------------------------------------------
/**
 * 507 InsufficientStorage — the write can't be accepted because the DATA_DIR
 * volume is at/under its free-space reserve or a configured storage quota is
 * exhausted (TASK-2140, CWE-770). Not in the classic S3 taxonomy but understood
 * by the SDKs as a retriable server-storage condition; rendered with an XML
 * `<Code>` body by the S3 exception filter like every other S3Error.
 */
export class InsufficientStorageError extends S3Error {
  readonly code = 'InsufficientStorage';
  readonly httpStatus = 507;
  constructor(message = 'Not enough storage available to complete the request.') {
    super(message);
  }
}

// -- 503 --------------------------------------------------------------
export class ServiceUnavailableError extends S3Error {
  readonly code = 'ServiceUnavailable';
  readonly httpStatus = 503;
}
export class SlowDownError extends S3Error {
  readonly code = 'SlowDown';
  readonly httpStatus = 503;
}

// -- 500 --------------------------------------------------------------
export class InternalError extends S3Error {
  readonly code = 'InternalError';
  readonly httpStatus = 500;
  constructor() {
    super('We encountered an internal error. Please try again.');
  }
}
