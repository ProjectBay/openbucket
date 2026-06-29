import {
  AccessDeniedError,
  BucketAlreadyExistsError,
  BucketAlreadyOwnedByYouError,
  BucketNotEmptyError,
  EntityTooLargeError,
  EntityTooSmallError,
  IncompleteBodyError,
  InternalError,
  InvalidArgumentError,
  InvalidBucketNameError,
  InvalidBucketStateError,
  InvalidPartError,
  InvalidPartOrderError,
  InvalidRangeError,
  InvalidRequestError,
  MalformedXMLError,
  MissingContentLengthError,
  NoSuchBucketError,
  NoSuchBucketPolicyError,
  NoSuchCORSConfigurationError,
  NoSuchKeyError,
  NoSuchLifecycleConfigurationError,
  NoSuchTagSetError,
  NoSuchUploadError,
  NoSuchVersionError,
  NotImplementedError,
  OperationAbortedError,
  PreconditionFailedError,
  RequestTimeTooSkewedError,
  S3Error,
  ServiceUnavailableError,
  SignatureDoesNotMatchError,
  SlowDownError,
} from './s3-error';

/**
 * TEST-0109 — S3 error taxonomy unit (WHITEPAPER §2.6).
 *
 * Every concrete class is asserted for `code` (verbatim AWS string),
 * `httpStatus`, default `message`, and documented `extra` keys.
 */
describe('S3 error taxonomy (TEST-0109)', () => {
  // Each row: instance, expected code, expected httpStatus, expected message.
  const rows: Array<[S3Error, string, number, string]> = [
    // -- 400 --
    [
      new InvalidBucketNameError('My.Bucket'),
      'InvalidBucketName',
      400,
      'The specified bucket is not valid: My.Bucket',
    ],
    [new InvalidArgumentError('bad arg'), 'InvalidArgument', 400, 'bad arg'],
    [
      new MalformedXMLError(),
      'MalformedXML',
      400,
      'The XML you provided was not well-formed',
    ],
    [
      new InvalidPartError(),
      'InvalidPart',
      400,
      'One or more of the specified parts could not be found.',
    ],
    [
      new InvalidPartOrderError(),
      'InvalidPartOrder',
      400,
      'The list of parts was not in ascending order.',
    ],
    [new InvalidRequestError('nope'), 'InvalidRequest', 400, 'nope'],
    [
      new EntityTooSmallError(),
      'EntityTooSmall',
      400,
      'Your proposed upload is smaller than the minimum allowed object size.',
    ],
    [new IncompleteBodyError('short'), 'IncompleteBody', 400, 'short'],
    [new MissingContentLengthError('need length'), 'MissingContentLength', 411, 'need length'],
    [
      new RequestTimeTooSkewedError(0),
      'RequestTimeTooSkewed',
      403,
      'The difference between the request time and the current time is too large.',
    ],
    // -- 403 --
    [new AccessDeniedError(), 'AccessDenied', 403, 'Access Denied'],
    [
      new SignatureDoesNotMatchError(),
      'SignatureDoesNotMatch',
      403,
      'The request signature we calculated does not match the signature you provided. ' +
        'Check your key and signing method.',
    ],
    // -- 404 --
    [new NoSuchBucketError('b'), 'NoSuchBucket', 404, 'The specified bucket does not exist'],
    [new NoSuchKeyError('k'), 'NoSuchKey', 404, 'The specified key does not exist.'],
    [
      new NoSuchUploadError(),
      'NoSuchUpload',
      404,
      'The specified multipart upload does not exist.',
    ],
    [new NoSuchVersionError('gone'), 'NoSuchVersion', 404, 'gone'],
    [new NoSuchCORSConfigurationError('x'), 'NoSuchCORSConfiguration', 404, 'x'],
    [new NoSuchLifecycleConfigurationError('x'), 'NoSuchLifecycleConfiguration', 404, 'x'],
    [new NoSuchBucketPolicyError('x'), 'NoSuchBucketPolicy', 404, 'x'],
    [new NoSuchTagSetError('x'), 'NoSuchTagSet', 404, 'x'],
    // -- 409 --
    [new BucketAlreadyExistsError('x'), 'BucketAlreadyExists', 409, 'x'],
    [new BucketAlreadyOwnedByYouError('x'), 'BucketAlreadyOwnedByYou', 409, 'x'],
    [new BucketNotEmptyError('x'), 'BucketNotEmpty', 409, 'x'],
    [new InvalidBucketStateError('x'), 'InvalidBucketState', 409, 'x'],
    [new OperationAbortedError('x'), 'OperationAborted', 409, 'x'],
    // -- 412 / 416 --
    [new PreconditionFailedError('x'), 'PreconditionFailed', 412, 'x'],
    [new InvalidRangeError('x'), 'InvalidRange', 416, 'x'],
    // -- 413 --
    [
      new EntityTooLargeError(100, 50),
      'EntityTooLarge',
      413,
      'Your proposed upload exceeds the maximum allowed object size.',
    ],
    // -- 500 / 501 / 503 --
    [
      new InternalError(),
      'InternalError',
      500,
      'We encountered an internal error. Please try again.',
    ],
    [
      new NotImplementedError('SelectObjectContent'),
      'NotImplemented',
      501,
      'The SelectObjectContent operation is not implemented by OpenBucket.',
    ],
    [new ServiceUnavailableError('busy'), 'ServiceUnavailable', 503, 'busy'],
    [new SlowDownError('slow'), 'SlowDown', 503, 'slow'],
  ];

  it.each(rows)(
    'case 1: %s carries the verbatim code, status, and message',
    (err, code, httpStatus, message) => {
      expect(err).toBeInstanceOf(S3Error);
      expect(err).toBeInstanceOf(Error);
      expect(err.code).toBe(code);
      expect(err.httpStatus).toBe(httpStatus);
      expect(err.message).toBe(message);
    },
  );

  it('case 1b: name matches the concrete constructor', () => {
    expect(new NoSuchKeyError('k').name).toBe('NoSuchKeyError');
  });

  it('case 1c: extra is a fresh per-instance object (not shared on the prototype)', () => {
    const a = new NoSuchKeyError('a');
    const b = new NoSuchKeyError('b');
    expect(a.extra).not.toBe(b.extra);
    expect(a.extra.Key).toBe('a');
    expect(b.extra.Key).toBe('b');
  });

  it('case 2: InvalidArgumentError records ArgumentName and ArgumentValue', () => {
    const e = new InvalidArgumentError('msg', 'argName', 'val');
    expect(e.extra.ArgumentName).toBe('argName');
    expect(e.extra.ArgumentValue).toBe('val');
    // omitted when not supplied
    expect(new InvalidArgumentError('msg').extra).toEqual({});
  });

  it('case 3: EntityTooLargeError records ProposedSize and MaxSizeAllowed', () => {
    const e = new EntityTooLargeError(100, 50);
    expect(e.extra.ProposedSize).toBe(100);
    expect(e.extra.MaxSizeAllowed).toBe(50);
  });

  it('case 4: RequestTimeTooSkewedError emits ISO 8601 ServerTime and RequestTime', () => {
    const e = new RequestTimeTooSkewedError(0);
    const iso = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
    expect(String(e.extra.ServerTime)).toMatch(iso);
    expect(String(e.extra.RequestTime)).toMatch(iso);
    expect(e.extra.ServerTime).toBe('1970-01-01T00:00:00.000Z');
  });

  it('case 5: NotImplementedError records the operation in extra and message', () => {
    const e = new NotImplementedError('SelectObjectContent');
    expect(e.extra.Operation).toBe('SelectObjectContent');
    expect(e.message).toBe(
      'The SelectObjectContent operation is not implemented by OpenBucket.',
    );
  });

  it('case 6: classes that carry an identifier surface it in extra', () => {
    expect(new InvalidBucketNameError('B').extra.BucketName).toBe('B');
    expect(new NoSuchBucketError('B').extra.BucketName).toBe('B');
    expect(new NoSuchKeyError('K').extra.Key).toBe('K');
    expect(new InvalidPartError(7).extra.PartNumber).toBe(7);
  });
});
