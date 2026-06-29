import { resolveOptions } from './open-bucket-options';

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
