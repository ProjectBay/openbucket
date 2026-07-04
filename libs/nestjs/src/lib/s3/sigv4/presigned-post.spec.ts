import {
  AccessDeniedError,
  EntityTooLargeError,
  EntityTooSmallError,
  MalformedPolicyError,
} from '../errors/s3-error';
import {
  accessKeyIdFromCredential,
  buildPresignedPost,
  evaluatePostPolicy,
  parsePostPolicy,
  policyContentLengthRange,
  scopeFromCredential,
  verifyPostSignature,
  type PostPolicy,
  type PresignPostInput,
} from './presigned-post';

/**
 * TEST-0802 — pure POST-policy crypto (mint, parse, evaluate, verify). No Nest /
 * HTTP / MikroORM deps: exercised in isolation.
 */
const SECRET = 'k7Jf2pQrwStN9vB3zX1cM4dL0eR6yU2h7gK3nP5s';
const BASE: PresignPostInput = {
  accessKeyId: 'AKIAEXAMPLE000000000',
  secretAccessKey: SECRET,
  region: 'us-east-1',
  scheme: 'https',
  host: 'files.example.com',
  bucket: 'b',
  key: 'uploads/a.png',
  expiresIn: 900,
  now: new Date('2026-07-02T12:00:00.000Z'),
};

function decodePolicy(fields: Record<string, string>): PostPolicy {
  return JSON.parse(Buffer.from(fields.policy, 'base64').toString('utf8'));
}

describe('buildPresignedPost (TEST-0802 mint)', () => {
  it('mints url + the six required fields with an exact key condition', () => {
    const { url, fields } = buildPresignedPost(BASE);
    expect(url).toBe('https://files.example.com/b');
    for (const f of [
      'key',
      'x-amz-algorithm',
      'x-amz-credential',
      'x-amz-date',
      'policy',
      'x-amz-signature',
    ]) {
      expect(fields[f]).toBeTruthy();
    }
    expect(fields['x-amz-algorithm']).toBe('AWS4-HMAC-SHA256');
    const policy = decodePolicy(fields);
    expect(policy.conditions).toContainEqual({ bucket: 'b' });
    expect(policy.conditions).toContainEqual({ key: 'uploads/a.png' });
  });

  it('applies the mount prefix and url-encodes the bucket', () => {
    const { url } = buildPresignedPost({ ...BASE, basePath: '/storage/' });
    expect(url).toBe('https://files.example.com/storage/b');
  });

  it('derives a starts-with key condition for a ${filename} template', () => {
    const { fields } = buildPresignedPost({ ...BASE, key: 'u/${filename}' });
    const policy = decodePolicy(fields);
    expect(policy.conditions).toContainEqual(['starts-with', '$key', 'u/']);
    expect(fields.key).toBe('u/${filename}');
  });

  it('maps contentType/contentLengthRange/success into conditions + fields', () => {
    const { fields } = buildPresignedPost({
      ...BASE,
      contentType: { startsWith: 'image/' },
      successActionStatus: '201',
      extraConditions: [['content-length-range', 1, 10485760]],
    });
    const policy = decodePolicy(fields);
    expect(policy.conditions).toContainEqual(['starts-with', '$Content-Type', 'image/']);
    expect(policy.conditions).toContainEqual({ success_action_status: '201' });
    expect(policy.conditions).toContainEqual(['content-length-range', 1, 10485760]);
    expect(fields['success_action_status']).toBe('201');
  });
});

describe('verifyPostSignature round-trip (TEST-0802)', () => {
  it('a freshly minted policy verifies true', () => {
    const { fields } = buildPresignedPost(BASE);
    expect(verifyPostSignature(fields, SECRET)).toBe(true);
  });

  it('flipping one byte of policy or signature fails', () => {
    const { fields } = buildPresignedPost(BASE);
    const tamperedPolicy = { ...fields, policy: 'A' + fields.policy.slice(1) };
    expect(verifyPostSignature(tamperedPolicy, SECRET)).toBe(false);
    const tamperedSig = {
      ...fields,
      'x-amz-signature': fields['x-amz-signature'].replace(/.$/, (c) => (c === '0' ? '1' : '0')),
    };
    expect(verifyPostSignature(tamperedSig, SECRET)).toBe(false);
  });

  it('returns false for a wrong secret, bad algorithm, or bad scope (no throw)', () => {
    const { fields } = buildPresignedPost(BASE);
    expect(verifyPostSignature(fields, 'wrong-secret')).toBe(false);
    expect(verifyPostSignature({ ...fields, 'x-amz-algorithm': 'nope' }, SECRET)).toBe(false);
    expect(
      verifyPostSignature({ ...fields, 'x-amz-credential': 'AKID/2026/us/xx/bad' }, SECRET),
    ).toBe(false);
  });
});

describe('credential helpers (TEST-0802)', () => {
  it('extracts the access-key id and scope', () => {
    const { fields } = buildPresignedPost(BASE);
    expect(accessKeyIdFromCredential(fields['x-amz-credential'])).toBe('AKIAEXAMPLE000000000');
    expect(scopeFromCredential(fields['x-amz-credential'])).toBe(
      '20260702/us-east-1/s3/aws4_request',
    );
  });
  it('rejects a malformed credential', () => {
    expect(accessKeyIdFromCredential('too/few')).toBeNull();
    expect(scopeFromCredential('AKID/2026/us/notservice/aws4_request')).toBeNull();
    expect(scopeFromCredential(undefined)).toBeNull();
  });
});

describe('parsePostPolicy (TEST-0802)', () => {
  it('round-trips a minted policy', () => {
    const { fields } = buildPresignedPost(BASE);
    const p = parsePostPolicy(fields.policy);
    expect(p.expiration).toBe('2026-07-02T12:15:00.000Z');
    expect(Array.isArray(p.conditions)).toBe(true);
  });
  it('throws MalformedPolicy on junk, empty, missing keys, or over-size', () => {
    expect(() => parsePostPolicy('')).toThrow(MalformedPolicyError);
    expect(() => parsePostPolicy(Buffer.from('not json').toString('base64'))).toThrow(
      MalformedPolicyError,
    );
    expect(() =>
      parsePostPolicy(Buffer.from(JSON.stringify({ conditions: [] })).toString('base64')),
    ).toThrow(MalformedPolicyError);
    expect(() => parsePostPolicy('A'.repeat(20 * 1024 + 1))).toThrow(MalformedPolicyError);
  });
});

describe('evaluatePostPolicy (TEST-0802)', () => {
  function fresh(overrides: Partial<PresignPostInput> = {}): Record<string, string> {
    const { fields } = buildPresignedPost({
      ...BASE,
      now: new Date(),
      key: 'u/${filename}',
      extraConditions: [['content-length-range', 1, 1024]],
      ...overrides,
    });
    // The browser substitutes ${filename} and appends the file part.
    return { ...fields, key: 'u/photo.png' };
  }

  it('accepts a compliant submission', () => {
    const fields = fresh();
    expect(() => evaluatePostPolicy(parsePostPolicy(fields.policy), fields, 'b', 512)).not.toThrow();
  });

  it('throws AccessDenied for an expired policy', () => {
    const { fields } = buildPresignedPost({ ...BASE, now: new Date(Date.now() - 3600_000) });
    expect(() => evaluatePostPolicy(parsePostPolicy(fields.policy), fields, 'b')).toThrow(
      /expired/i,
    );
  });

  it('throws AccessDenied for a failed starts-with $key', () => {
    const fields: Record<string, string> = { ...fresh(), key: 'other/photo.png' };
    expect(() => evaluatePostPolicy(parsePostPolicy(fields.policy), fields, 'b', 512)).toThrow(
      AccessDeniedError,
    );
  });

  it('throws EntityTooLarge / EntityTooSmall for an out-of-range length', () => {
    const fields = fresh();
    const policy = parsePostPolicy(fields.policy);
    expect(() => evaluatePostPolicy(policy, fields, 'b', 2048)).toThrow(EntityTooLargeError);
    expect(() => evaluatePostPolicy(policy, fields, 'b', 0)).toThrow(EntityTooSmallError);
  });

  it('fails closed for an uncovered extra field', () => {
    const fields: Record<string, string> = { ...fresh(), 'x-injected': 'evil' };
    expect(() => evaluatePostPolicy(parsePostPolicy(fields.policy), fields, 'b', 512)).toThrow(
      AccessDeniedError,
    );
  });

  it('skips the length check when streamedBytes is undefined (up-front pass)', () => {
    const fields = fresh();
    expect(() => evaluatePostPolicy(parsePostPolicy(fields.policy), fields, 'b')).not.toThrow();
  });

  it('exposes the content-length-range for wire enforcement', () => {
    const fields = fresh();
    expect(policyContentLengthRange(parsePostPolicy(fields.policy))).toEqual({ min: 1, max: 1024 });
  });
});
