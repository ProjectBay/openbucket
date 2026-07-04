import type { PolicyDocument } from '../../persistence/entities/types';
import { operationToAction } from './operation-action';
import { evaluatePolicy, type PolicyEvaluationContext } from './policy-evaluator';

/**
 * TASK-2120 / TEST-0702 — bucket-policy evaluator (finding [11], CWE-862).
 *
 * Covers action/resource/principal glob matching, explicit-Deny-overrides,
 * the advertised Condition operators (Bool aws:SecureTransport, IpAddress /
 * NotIpAddress aws:SourceIp) including fail-closed handling of unknown
 * operators, and the operation→action mapping.
 */

function ctx(overrides: Partial<PolicyEvaluationContext> = {}): PolicyEvaluationContext {
  return {
    action: 's3:GetObject',
    resource: 'arn:aws:s3:::b/key.txt',
    principal: 'AKROOT',
    secureTransport: true,
    sourceIp: '10.0.0.5',
    ...overrides,
  };
}

function policy(...statements: PolicyDocument['Statement']): PolicyDocument {
  return { Version: '2012-10-17', Statement: statements };
}

describe('evaluatePolicy', () => {
  describe('defaults', () => {
    it('default-allows the root principal when no statement matches', () => {
      const p = policy({
        Effect: 'Allow',
        Principal: '*',
        Action: 's3:PutObject',
        Resource: 'arn:aws:s3:::b/*',
      });
      expect(evaluatePolicy(p, ctx(), { defaultAllow: true })).toBe('allow');
    });

    it('implicit-denies (defaultAllow=false) when no Allow matches', () => {
      const p = policy({
        Effect: 'Allow',
        Principal: '*',
        Action: 's3:PutObject',
        Resource: 'arn:aws:s3:::b/*',
      });
      expect(evaluatePolicy(p, ctx(), { defaultAllow: false })).toBe('deny');
    });

    it('allows an anonymous principal with an explicit matching Allow', () => {
      const p = policy({
        Effect: 'Allow',
        Principal: '*',
        Action: 's3:GetObject',
        Resource: 'arn:aws:s3:::b/*',
      });
      expect(evaluatePolicy(p, ctx({ principal: '*' }), { defaultAllow: false })).toBe('allow');
    });

    it('treats a null/empty policy as no-statements (default fallback)', () => {
      expect(evaluatePolicy(null, ctx(), { defaultAllow: true })).toBe('allow');
      expect(evaluatePolicy(undefined, ctx(), { defaultAllow: false })).toBe('deny');
    });
  });

  describe('deny-overrides', () => {
    it('returns deny for a matching Deny even when an Allow also matches', () => {
      const p = policy(
        { Effect: 'Allow', Principal: '*', Action: 's3:*', Resource: 'arn:aws:s3:::b/*' },
        { Effect: 'Deny', Principal: '*', Action: 's3:GetObject', Resource: 'arn:aws:s3:::b/*' },
      );
      expect(evaluatePolicy(p, ctx(), { defaultAllow: true })).toBe('deny');
    });

    it('deny wins regardless of statement order (Deny listed first)', () => {
      const p = policy(
        { Effect: 'Deny', Principal: '*', Action: 's3:GetObject', Resource: 'arn:aws:s3:::b/*' },
        { Effect: 'Allow', Principal: '*', Action: 's3:*', Resource: 'arn:aws:s3:::b/*' },
      );
      expect(evaluatePolicy(p, ctx(), { defaultAllow: true })).toBe('deny');
    });
  });

  describe('action matching (glob)', () => {
    const deny = (action: string): PolicyDocument =>
      policy({ Effect: 'Deny', Principal: '*', Action: action, Resource: '*' });

    it('matches s3:* wildcard', () => {
      expect(evaluatePolicy(deny('s3:*'), ctx(), { defaultAllow: true })).toBe('deny');
    });
    it('matches a prefix glob s3:Get*', () => {
      expect(evaluatePolicy(deny('s3:Get*'), ctx(), { defaultAllow: true })).toBe('deny');
    });
    it('does not match a different action', () => {
      expect(evaluatePolicy(deny('s3:PutObject'), ctx(), { defaultAllow: true })).toBe('allow');
    });
    it('matches when Action is an array containing the action', () => {
      const p = policy({
        Effect: 'Deny',
        Principal: '*',
        Action: ['s3:PutObject', 's3:GetObject'],
        Resource: '*',
      });
      expect(evaluatePolicy(p, ctx(), { defaultAllow: true })).toBe('deny');
    });
  });

  describe('resource matching', () => {
    it('matches arn:aws:s3:::b/* against an object key', () => {
      const p = policy({
        Effect: 'Deny',
        Principal: '*',
        Action: 's3:GetObject',
        Resource: 'arn:aws:s3:::b/*',
      });
      expect(evaluatePolicy(p, ctx(), { defaultAllow: true })).toBe('deny');
    });
    it('does not match a different bucket', () => {
      const p = policy({
        Effect: 'Deny',
        Principal: '*',
        Action: 's3:GetObject',
        Resource: 'arn:aws:s3:::other/*',
      });
      expect(evaluatePolicy(p, ctx(), { defaultAllow: true })).toBe('allow');
    });
    it('matches the bucket ARN itself for ListBucket', () => {
      const p = policy({
        Effect: 'Deny',
        Principal: '*',
        Action: 's3:ListBucket',
        Resource: 'arn:aws:s3:::b',
      });
      expect(
        evaluatePolicy(p, ctx({ action: 's3:ListBucket', resource: 'arn:aws:s3:::b' }), {
          defaultAllow: true,
        }),
      ).toBe('deny');
    });
  });

  describe('principal matching', () => {
    const deny = (principal: PolicyDocument['Statement'][number]['Principal']): PolicyDocument =>
      policy({ Effect: 'Deny', Principal: principal, Action: 's3:*', Resource: '*' });

    it('* matches any principal', () => {
      expect(evaluatePolicy(deny('*'), ctx(), { defaultAllow: true })).toBe('deny');
    });
    it('{AWS} matches the named principal', () => {
      expect(evaluatePolicy(deny({ AWS: 'AKROOT' }), ctx(), { defaultAllow: true })).toBe('deny');
    });
    it('{AWS} does not match a different principal', () => {
      expect(evaluatePolicy(deny({ AWS: 'AKOTHER' }), ctx(), { defaultAllow: true })).toBe('allow');
    });
  });

  describe('condition: Bool aws:SecureTransport', () => {
    const denyInsecure = policy({
      Effect: 'Deny',
      Principal: '*',
      Action: 's3:*',
      Resource: '*',
      Condition: { Bool: { 'aws:SecureTransport': 'false' } },
    });

    it('blocks a plain-HTTP request', () => {
      expect(
        evaluatePolicy(denyInsecure, ctx({ secureTransport: false }), { defaultAllow: true }),
      ).toBe('deny');
    });
    it('allows the same request over TLS', () => {
      expect(
        evaluatePolicy(denyInsecure, ctx({ secureTransport: true }), { defaultAllow: true }),
      ).toBe('allow');
    });
  });

  describe('condition: IpAddress / NotIpAddress aws:SourceIp', () => {
    it('NotIpAddress denies a request from outside the allowed CIDR', () => {
      const p = policy({
        Effect: 'Deny',
        Principal: '*',
        Action: 's3:*',
        Resource: '*',
        Condition: { NotIpAddress: { 'aws:SourceIp': '192.168.0.0/16' } },
      });
      expect(evaluatePolicy(p, ctx({ sourceIp: '10.0.0.5' }), { defaultAllow: true })).toBe('deny');
      expect(evaluatePolicy(p, ctx({ sourceIp: '192.168.1.9' }), { defaultAllow: true })).toBe(
        'allow',
      );
    });
    it('IpAddress matches inside the CIDR and matches v4-mapped IPv6 form', () => {
      const p = policy({
        Effect: 'Deny',
        Principal: '*',
        Action: 's3:*',
        Resource: '*',
        Condition: { IpAddress: { 'aws:SourceIp': '10.0.0.0/24' } },
      });
      expect(evaluatePolicy(p, ctx({ sourceIp: '10.0.0.7' }), { defaultAllow: true })).toBe('deny');
      expect(evaluatePolicy(p, ctx({ sourceIp: '::ffff:10.0.0.7' }), { defaultAllow: true })).toBe(
        'deny',
      );
      expect(evaluatePolicy(p, ctx({ sourceIp: '10.0.1.7' }), { defaultAllow: true })).toBe(
        'allow',
      );
    });
  });

  describe('unknown condition operators fail closed', () => {
    it('keeps a Deny whose condition operator is unrecognised (treated as matched)', () => {
      const p = policy({
        Effect: 'Deny',
        Principal: '*',
        Action: 's3:*',
        Resource: '*',
        Condition: { StringEqualsIfExists: { 'aws:username': 'nobody' } },
      });
      expect(evaluatePolicy(p, ctx(), { defaultAllow: true })).toBe('deny');
    });

    it('does not grant an Allow whose condition operator is unrecognised', () => {
      const p = policy({
        Effect: 'Allow',
        Principal: '*',
        Action: 's3:*',
        Resource: '*',
        Condition: { StringEquals: { 'aws:username': 'anyone' } },
      });
      expect(evaluatePolicy(p, ctx({ principal: '*' }), { defaultAllow: false })).toBe('deny');
    });
  });
});

describe('operationToAction', () => {
  it('maps core object ops 1:1', () => {
    expect(operationToAction('GetObject')).toBe('s3:GetObject');
    expect(operationToAction('PutObject')).toBe('s3:PutObject');
    expect(operationToAction('DeleteObject')).toBe('s3:DeleteObject');
  });
  it('folds listings and heads onto their IAM action', () => {
    expect(operationToAction('ListObjectsV2')).toBe('s3:ListBucket');
    expect(operationToAction('ListObjects')).toBe('s3:ListBucket');
    expect(operationToAction('HeadBucket')).toBe('s3:ListBucket');
    expect(operationToAction('HeadObject')).toBe('s3:GetObject');
  });
  it('folds multipart writes onto s3:PutObject', () => {
    expect(operationToAction('UploadPart')).toBe('s3:PutObject');
    expect(operationToAction('CompleteMultipartUpload')).toBe('s3:PutObject');
    expect(operationToAction('CopyObject')).toBe('s3:PutObject');
  });
  it('returns undefined for an unknown/absent operation', () => {
    expect(operationToAction(undefined)).toBeUndefined();
  });
});
