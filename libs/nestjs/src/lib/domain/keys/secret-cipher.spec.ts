import { ConfigService } from '@nestjs/config';

import { SecretCipher } from './secret-cipher';

/**
 * TASK-3001 / [TEST-1000] — SecretCipher AES-256-GCM round-trip + tamper reject.
 */
const cfg = (env: Record<string, string | undefined>) =>
  ({ get: (k: string) => env[k] }) as unknown as ConfigService;

describe('SecretCipher (TASK-3001)', () => {
  it('round-trips: decrypt(encrypt(s)) === s', () => {
    const c = new SecretCipher(cfg({ ROOT_SECRET_ACCESS_KEY: 'root-secret-material' }));
    const secret = 'sK+plaintext/40charsecretvalue==example';
    expect(c.decrypt(c.encrypt(secret))).toBe(secret);
  });

  it('produces a versioned v1.iv.tag.ct envelope with a fresh IV each time', () => {
    const c = new SecretCipher(cfg({ ROOT_SECRET_ACCESS_KEY: 'root-secret-material' }));
    const a = c.encrypt('same');
    const b = c.encrypt('same');
    expect(a.split('.')).toHaveLength(4);
    expect(a.startsWith('v1.')).toBe(true);
    expect(a).not.toBe(b); // random IV ⇒ distinct ciphertexts
  });

  it('throws on a tampered ciphertext (GCM auth tag)', () => {
    const c = new SecretCipher(cfg({ ROOT_SECRET_ACCESS_KEY: 'root-secret-material' }));
    const blob = c.encrypt('secret');
    const parts = blob.split('.');
    const tamperedCt = Buffer.from(parts[3], 'base64url');
    tamperedCt[0] ^= 0xff;
    parts[3] = tamperedCt.toString('base64url');
    expect(() => c.decrypt(parts.join('.'))).toThrow();
  });

  it('throws on a malformed envelope', () => {
    const c = new SecretCipher(cfg({ ROOT_SECRET_ACCESS_KEY: 'root-secret-material' }));
    expect(() => c.decrypt('not-a-valid-blob')).toThrow(/malformed/);
  });

  it('prefers KEY_ENCRYPTION_SECRET over ROOT_SECRET_ACCESS_KEY for the KEK', () => {
    const secret = 'the-secret';
    const withKek = new SecretCipher(
      cfg({ KEY_ENCRYPTION_SECRET: 'dedicated-kek-material', ROOT_SECRET_ACCESS_KEY: 'root' }),
    );
    const blob = withKek.encrypt(secret);
    // A cipher keyed only off ROOT can't decrypt a blob wrapped with the dedicated KEK.
    const rootOnly = new SecretCipher(cfg({ ROOT_SECRET_ACCESS_KEY: 'root' }));
    expect(() => rootOnly.decrypt(blob)).toThrow();
    // ...but a second cipher with the same KEY_ENCRYPTION_SECRET can.
    const sameKek = new SecretCipher(cfg({ KEY_ENCRYPTION_SECRET: 'dedicated-kek-material' }));
    expect(sameKek.decrypt(blob)).toBe(secret);
  });
});
