import { resolveOptions } from '../../open-bucket-options';
import { buildConfig } from './config-source';

describe('buildConfig (dual-mode config source)', () => {
  it('maps resolved options → config shape (library / forRoot path)', () => {
    const cfg = buildConfig(
      resolveOptions({
        dataDir: '/data',
        rootCredentials: { accessKeyId: 'AKIAEXAMPLE', secretAccessKey: 'sk' },
        region: 'eu-west-1',
        endpoint: 's3.example.com',
        admin: { username: 'root', passwordHash: '$argon2id$x', jwtSecret: 'jwt-secret' },
        limits: { maxObjectSizeMb: 100, maxMultipartParts: 5000 },
      }),
    );
    expect(cfg.DATA_DIR).toBe('/data');
    expect(cfg.OPENBUCKET_REGION).toBe('eu-west-1');
    expect(cfg.OPENBUCKET_ENDPOINT).toBe('s3.example.com');
    expect(cfg.ROOT_ACCESS_KEY_ID).toBe('AKIAEXAMPLE');
    expect(cfg.JWT_SECRET).toBe('jwt-secret');
    expect(cfg.ADMIN_USERNAME).toBe('root');
    expect(cfg.MAX_OBJECT_SIZE_MB).toBe(100);
    expect(cfg.MAX_MULTIPART_PARTS).toBe(5000);
    expect(cfg.MULTIPART_TTL_HOURS).toBe(24); // default
    expect(cfg.JWT_ACCESS_TTL_SECONDS).toBe(900); // default
  });

  it('falls back to loadEnv(process.env) when no options (standalone path)', () => {
    const saved = { ...process.env };
    Object.assign(process.env, {
      NODE_ENV: 'test',
      DATA_DIR: '/d',
      JWT_SECRET: 'x'.repeat(40),
      ROOT_ACCESS_KEY_ID: 'AKIA0000000000000000',
      ROOT_SECRET_ACCESS_KEY: 'y'.repeat(40),
      ADMIN_PASSWORD_HASH: '$argon2id$v=19$m=65536,t=3,p=4$abc$def',
    });
    try {
      const cfg = buildConfig(undefined);
      expect(cfg.DATA_DIR).toBe('/d');
      expect(cfg.OPENBUCKET_REGION).toBe('us-east-1'); // schema default
      expect(cfg.MULTIPART_TTL_HOURS).toBe(24);
    } finally {
      process.env = saved;
    }
  });
});
