import {
  compileScopeToPolicy,
  parseScopePolicy,
  serializeScope,
  summarizeScope,
  KeyScope,
  DENY_ALL_SCOPE,
  MAX_SCOPE_BYTES,
} from './key-scope';

/**
 * TASK-3000 / [TEST-1000] — KeyScope schema + prefix→policy compiler + parser.
 */
describe('KeyScope compiler (TASK-3000)', () => {
  it('compiles a prefix scope to an object Allow + a StringLike-gated ListBucket Allow', () => {
    const doc = compileScopeToPolicy({ kind: 'prefix', bucket: 't-a', prefix: 'tenant-a/' });
    expect(doc.Version).toBe('2012-10-17');

    const obj = doc.Statement.find((s) => s.Sid === 'ScopeObjects');
    expect(obj).toMatchObject({
      Effect: 'Allow',
      Principal: '*',
      Resource: 'arn:aws:s3:::t-a/tenant-a/*',
      Action: ['s3:GetObject', 's3:PutObject', 's3:DeleteObject'],
    });

    const list = doc.Statement.find((s) => s.Sid === 'ScopeList');
    expect(list).toMatchObject({
      Effect: 'Allow',
      Resource: 'arn:aws:s3:::t-a',
      Action: 's3:ListBucket',
      Condition: { StringLike: { 's3:prefix': ['tenant-a/*', 'tenant-a/'] } },
    });
  });

  it('defaults to an empty prefix (whole-bucket) when none is given', () => {
    const doc = compileScopeToPolicy({ kind: 'prefix', bucket: 't-a' });
    expect(doc.Statement.find((s) => s.Sid === 'ScopeObjects')?.Resource).toBe('arn:aws:s3:::t-a/*');
  });

  it('honours a custom action subset (read-only omits the ListBucket statement)', () => {
    const doc = compileScopeToPolicy({
      kind: 'prefix',
      bucket: 't-a',
      prefix: 'ro/',
      actions: ['s3:GetObject'],
    });
    expect(doc.Statement).toHaveLength(1);
    expect(doc.Statement[0]).toMatchObject({ Action: ['s3:GetObject'], Sid: 'ScopeObjects' });
  });

  it('escapes glob metacharacters so a "*" in the prefix cannot widen the ARN', () => {
    const doc = compileScopeToPolicy({ kind: 'prefix', bucket: 't-a', prefix: 'a*b/' });
    const resource = doc.Statement.find((s) => s.Sid === 'ScopeObjects')?.Resource as string;
    // The literal `*` must NOT survive as a bare wildcard in the ARN.
    expect(resource).not.toContain('a*b');
    expect(resource.startsWith('arn:aws:s3:::t-a/a')).toBe(true);
    expect(resource.endsWith('b/*')).toBe(true);
  });

  it('passes an inline policy form through unchanged', () => {
    const document = {
      Version: '2012-10-17' as const,
      Statement: [
        { Effect: 'Allow' as const, Principal: '*' as const, Action: 's3:GetObject', Resource: '*' },
      ],
    };
    expect(compileScopeToPolicy({ kind: 'policy', document })).toBe(document);
  });
});

describe('KeyScope schema (TASK-3000)', () => {
  it('rejects a bad bucket name', () => {
    expect(KeyScope.safeParse({ kind: 'prefix', bucket: 'A_B' }).success).toBe(false);
  });

  it('rejects a prefix with a ".." segment or a leading slash', () => {
    expect(KeyScope.safeParse({ kind: 'prefix', bucket: 't-a', prefix: '../x' }).success).toBe(false);
    expect(KeyScope.safeParse({ kind: 'prefix', bucket: 't-a', prefix: '/x' }).success).toBe(false);
  });

  it('rejects an oversized inline policy', () => {
    const big = 'x'.repeat(MAX_SCOPE_BYTES);
    const document = {
      Version: '2012-10-17',
      Statement: [{ Effect: 'Allow', Principal: '*', Action: 's3:GetObject', Resource: big }],
    };
    expect(KeyScope.safeParse({ kind: 'policy', document }).success).toBe(false);
  });
});

describe('parseScopePolicy (TASK-3000)', () => {
  it('returns null for a null/absent scope (unscoped key)', () => {
    expect(parseScopePolicy(null)).toBeNull();
    expect(parseScopePolicy(undefined)).toBeNull();
  });

  it('round-trips a valid stored document', () => {
    const doc = compileScopeToPolicy({ kind: 'prefix', bucket: 't-a', prefix: 'p/' });
    expect(parseScopePolicy(serializeScope(doc))).toEqual(doc);
  });

  it('fails closed to a deny-all document on malformed JSON', () => {
    expect(parseScopePolicy('{not valid json')).toEqual(DENY_ALL_SCOPE);
  });

  it('fails closed to a deny-all document on a schema-invalid policy', () => {
    expect(parseScopePolicy(JSON.stringify({ Version: 'nope', Statement: [] }))).toEqual(DENY_ALL_SCOPE);
  });
});

describe('summarizeScope (TASK-3003)', () => {
  it('reconstructs bucket + prefix from a compiled prefix scope', () => {
    const doc = compileScopeToPolicy({ kind: 'prefix', bucket: 't-a', prefix: 'tenant-a/' });
    expect(summarizeScope(serializeScope(doc))).toEqual({
      kind: 'prefix',
      bucket: 't-a',
      prefix: 'tenant-a/',
    });
  });

  it('returns null for an unscoped key and {kind:policy} for a non-prefix shape', () => {
    expect(summarizeScope(null)).toBeNull();
    expect(summarizeScope(JSON.stringify(DENY_ALL_SCOPE))).toEqual({ kind: 'policy' });
  });
});
