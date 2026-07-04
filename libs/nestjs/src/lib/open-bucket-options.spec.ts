import { resolveOptions, validateSecurityCriticalOptions } from './open-bucket-options';

describe('resolveOptions', () => {
  const base = {
    dataDir: '/data',
    rootCredentials: { accessKeyId: 'AKIA', secretAccessKey: 'secret' },
  };

  it('applies defaults', () => {
    const r = resolveOptions(base);
    expect(r.mountPath).toBe('/storage');
    expect(r.region).toBe('us-east-1');
    expect(r.limits.multipartTtlHours).toBe(24);
    expect(r.admin).toBeUndefined();
  });

  it('defaults admin.serveUi to true when admin is provided', () => {
    const r = resolveOptions({ ...base, admin: { username: 'a', passwordHash: 'h', jwtSecret: 'j' } });
    expect(r.admin?.serveUi).toBe(true);
  });

  it('normalizes the mount path (leading slash, no trailing slash; root → "")', () => {
    expect(resolveOptions({ ...base, mountPath: 'storage/' }).mountPath).toBe('/storage');
    expect(resolveOptions({ ...base, mountPath: '/s3/' }).mountPath).toBe('/s3');
    expect(resolveOptions({ ...base, mountPath: '/' }).mountPath).toBe('');
  });

  it('requires dataDir and rootCredentials', () => {
    expect(() => resolveOptions({ ...base, dataDir: '' })).toThrow(/dataDir/);
    expect(() =>
      resolveOptions({ ...base, rootCredentials: { accessKeyId: '', secretAccessKey: '' } }),
    ).toThrow(/rootCredentials/);
  });
});

describe('validateSecurityCriticalOptions', () => {
  // High-entropy 40-char fixture that passes the strong-secret guard (TASK-2151).
  const SECRET = 'k7Jf2pQrwStN9vB3zX1cM4dL0eR6yU2h7gK3nP5s';
  const HASH = '$argon2id$v=19$m=65536,t=3,p=4$abc$def';
  const validBase = {
    dataDir: '/data',
    rootCredentials: { accessKeyId: 'AKIAEXAMPLE000000000', secretAccessKey: SECRET },
    admin: { username: 'admin', passwordHash: HASH, jwtSecret: SECRET },
  };
  const validate = (o: Parameters<typeof resolveOptions>[0]) =>
    validateSecurityCriticalOptions(resolveOptions(o));

  it('passes on well-formed secrets (with admin)', () => {
    expect(() => validate(validBase)).not.toThrow();
  });

  it('passes on a headless store (no admin) with a valid secret key', () => {
    const { admin, ...headless } = validBase;
    void admin;
    expect(() => validate(headless)).not.toThrow();
  });

  it('accepts a base64-of-32-bytes sseKey and rejects a malformed one', () => {
    expect(() => validate({ ...validBase, sseKey: Buffer.alloc(32).toString('base64') })).not.toThrow();
    expect(() => validate({ ...validBase, sseKey: 'too-short' })).toThrow(/sseKey/);
  });

  it('rejects a too-short secret access key', () => {
    expect(() =>
      validate({ ...validBase, rootCredentials: { accessKeyId: 'AKIA', secretAccessKey: 'short' } }),
    ).toThrow(/secretAccessKey/);
  });

  it('rejects a non-argon2id password hash and a too-short jwtSecret', () => {
    expect(() => validate({ ...validBase, admin: { ...validBase.admin, passwordHash: 'plain' } })).toThrow(
      /argon2id/,
    );
    expect(() => validate({ ...validBase, admin: { ...validBase.admin, jwtSecret: 'short' } })).toThrow(
      /jwtSecret/,
    );
  });

  it('rejects a low-entropy (all-identical) secret access key (TASK-2151, CWE-521)', () => {
    expect(() =>
      validate({
        ...validBase,
        rootCredentials: { accessKeyId: 'AKIAEXAMPLE000000000', secretAccessKey: 'x'.repeat(40) },
      }),
    ).toThrow(/secretAccessKey/);
  });

  it('rejects a placeholder / low-entropy jwtSecret in the library path (TASK-2151)', () => {
    expect(() =>
      validate({ ...validBase, admin: { ...validBase.admin, jwtSecret: 'a'.repeat(32) } }),
    ).toThrow(/jwtSecret/);
    expect(() =>
      validate({ ...validBase, admin: { ...validBase.admin, jwtSecret: 'changeme'.padEnd(32, 'e') } }),
    ).toThrow(/jwtSecret/);
  });

  it('does NOT enforce the AWS access-key-id format (library callers may use arbitrary keys)', () => {
    expect(() =>
      validate({ ...validBase, rootCredentials: { accessKeyId: 'my-lowercase-key', secretAccessKey: SECRET } }),
    ).not.toThrow();
  });
});
