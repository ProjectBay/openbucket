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

  it('defaults maxObjectSizeMb to 5 GiB (matches the env schema, not the old 5 TiB footgun) (MF-3)', () => {
    expect(resolveOptions(base).limits.maxObjectSizeMb).toBe(5_120);
  });

  it('defaults admin.serveUi to true when admin is provided', () => {
    const r = resolveOptions({ ...base, admin: { username: 'a', passwordHash: 'h', jwtSecret: 'j' } });
    expect(r.admin?.serveUi).toBe(true);
  });

  it('accepts admin.password in place of passwordHash', () => {
    const r = resolveOptions({
      ...base,
      admin: { username: 'a', password: 'plaintext-admin-pw', jwtSecret: 'j' },
    });
    expect(r.admin?.password).toBe('plaintext-admin-pw');
    expect(r.admin?.passwordHash).toBeUndefined();
  });

  it('throws when the admin block has neither passwordHash nor password', () => {
    expect(() =>
      resolveOptions({ ...base, admin: { username: 'a', jwtSecret: 'j' } }),
    ).toThrow(/passwordHash.*password|password/);
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

  it('accepts a password-only admin block (no hash) — the admin.password path (MF-1)', () => {
    const { admin, ...rest } = validBase;
    void admin;
    expect(() =>
      validate({ ...rest, admin: { username: 'admin', password: 'a-strong-admin-pw', jwtSecret: SECRET } }),
    ).not.toThrow();
  });

  it('rejects a too-short admin.password (MF-2)', () => {
    const { admin, ...rest } = validBase;
    void admin;
    expect(() =>
      validate({ ...rest, admin: { username: 'admin', password: 'short', jwtSecret: SECRET } }),
    ).toThrow(/password/);
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

  // --- object-event webhooks (STORY-0801) ---
  it('passes with a well-formed webhooks block (https + strong secret)', () => {
    expect(() =>
      validate({ ...validBase, webhooks: { url: 'https://hooks.example.com/ob', secret: SECRET } }),
    ).not.toThrow();
  });

  it('allows an http webhook URL for a loopback host', () => {
    expect(() =>
      validate({ ...validBase, webhooks: { url: 'http://127.0.0.1:4000/hooks', secret: SECRET } }),
    ).not.toThrow();
  });

  it('rejects a non-https, non-loopback webhook URL', () => {
    expect(() =>
      validate({ ...validBase, webhooks: { url: 'http://hooks.example.com/ob', secret: SECRET } }),
    ).toThrow(/https/);
  });

  it('rejects a weak/short webhook secret (fail-closed, never sign with a weak key)', () => {
    expect(() =>
      validate({ ...validBase, webhooks: { url: 'https://hooks.example.com/ob', secret: 'short' } }),
    ).toThrow(/webhooks\.secret/);
  });

  // Scheduled backups (STORY-1203) — same fail-fast cron/interval guarantee the
  // standalone env schema gives.
  it('accepts a backups block with an interval', () => {
    expect(() => validate({ ...validBase, backups: { intervalMinutes: 60 } })).not.toThrow();
  });

  it('accepts a backups block with a valid cron', () => {
    expect(() => validate({ ...validBase, backups: { cron: '0 3 * * *' } })).not.toThrow();
  });

  it('rejects a backups block with NEITHER cron nor interval', () => {
    expect(() => validate({ ...validBase, backups: { keepLast: 5 } })).toThrow(
      /exactly one of `backups.cron` or `backups.intervalMinutes`/,
    );
  });

  it('rejects a backups block with BOTH cron and interval', () => {
    expect(() =>
      validate({ ...validBase, backups: { cron: '0 3 * * *', intervalMinutes: 60 } }),
    ).toThrow(/exactly one of/);
  });

  it('rejects a backups block with a malformed cron', () => {
    expect(() => validate({ ...validBase, backups: { cron: 'not a cron' } })).toThrow(
      /not a valid cron/,
    );
  });
});
