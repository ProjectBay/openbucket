/**
 * Unit coverage for the CLI's pure core (TEST-1201): config precedence +
 * endpoint validation, the exit-code map, `redact` regexes, and `fromResponse`
 * status→error mapping.
 */

import { parseCli } from './args';
import { resolveConfig } from './config';
import { CliError, EXIT, fromResponse, redact, usageError } from './errors';

describe('resolveConfig', () => {
  it('honours flag > env precedence and normalizes the endpoint', () => {
    const cfg = resolveConfig(
      { endpoint: 'http://127.0.0.1:9000/' },
      { OPENBUCKET_ENDPOINT: 'http://127.0.0.1:1111', OPENBUCKET_USERNAME: 'admin' },
    );
    expect(cfg.endpoint).toBe('http://127.0.0.1:9000'); // flag wins, trailing slash stripped
    expect(cfg.username).toBe('admin'); // from env (no flag)
  });

  it('reads the token only from $OPENBUCKET_TOKEN and never a password', () => {
    const cfg = resolveConfig({}, { OPENBUCKET_TOKEN: 'tok', OPENBUCKET_PASSWORD: 'pw' });
    expect(cfg.token).toBe('tok');
    expect(cfg as unknown as Record<string, unknown>).not.toHaveProperty('password');
  });

  it('rejects non-loopback plaintext http without --insecure', () => {
    expect(() => resolveConfig({ endpoint: 'http://example.com' }, {})).toThrow(CliError);
    // ...but allows it with --insecure
    expect(resolveConfig({ endpoint: 'http://example.com', insecure: true }, {}).endpoint).toBe(
      'http://example.com',
    );
  });

  it('allows https to any host and loopback http', () => {
    expect(resolveConfig({ endpoint: 'https://example.com' }, {}).endpoint).toBe(
      'https://example.com',
    );
    expect(resolveConfig({ endpoint: 'http://localhost:3900' }, {}).endpoint).toBe(
      'http://localhost:3900',
    );
  });
});

describe('parseCli', () => {
  it('splits command/subcommand positionals from flags', () => {
    const { flags, positionals } = parseCli(['buckets', 'mb', 'my-bucket', '--object-lock']);
    expect(positionals).toEqual(['buckets', 'mb', 'my-bucket']);
    expect(flags['object-lock']).toBe(true);
  });

  it('maps -o/-f short flags', () => {
    const { flags } = parseCli(['backup', 'create', '-o', 'out.zip']);
    expect(flags.output).toBe('out.zip');
  });

  it('turns an unknown option into a usage error (exit 2)', () => {
    try {
      parseCli(['buckets', 'ls', '--nope']);
      fail('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(CliError);
      expect((err as CliError).exitCode).toBe(EXIT.USAGE);
    }
  });
});

describe('redact', () => {
  it('strips bearer tokens, JWT triples, and secret/password fields', () => {
    const jwt =
      'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJhZG1pbiJ9.abcDEF123_-456';
    const dirty = `failed with Authorization: Bearer ${jwt} and {"secretAccessKey":"AKIAABC123","password":"hunter2"}`;
    const clean = redact(dirty);
    expect(clean).not.toContain(jwt);
    expect(clean).not.toContain('AKIAABC123');
    expect(clean).not.toContain('hunter2');
    expect(clean).toContain('[REDACTED]');
  });
});

describe('CliError', () => {
  it('carries an exit code and redacts on toStderr', () => {
    const e = new CliError('leak Bearer eyJabc.def.ghi token', EXIT.AUTH);
    expect(e.exitCode).toBe(EXIT.AUTH);
    expect(e.toStderr()).not.toContain('eyJabc.def.ghi');
  });

  it('usageError maps to exit 2', () => {
    expect(usageError('bad').exitCode).toBe(EXIT.USAGE);
  });
});

describe('fromResponse', () => {
  it('maps 401 to "invalid credentials" (exit 3) with no secret substring', async () => {
    const e = await fromResponse(new Response(JSON.stringify({ message: 'x' }), { status: 401 }));
    expect(e.exitCode).toBe(EXIT.AUTH);
    expect(e.message).toBe('invalid credentials');
  });

  it('maps 429 to a rate-limit message (exit 4) surfacing Retry-After', async () => {
    const e = await fromResponse(
      new Response(null, { status: 429, headers: { 'retry-after': '30' } }),
    );
    expect(e.exitCode).toBe(EXIT.RATE_LIMIT);
    expect(e.message).toContain('30s');
  });

  it('reads the admin JSON error message for other statuses (exit 1)', async () => {
    const e = await fromResponse(
      new Response(JSON.stringify({ error: 'BucketNotEmpty', message: 'bucket not empty' }), {
        status: 409,
      }),
    );
    expect(e.exitCode).toBe(EXIT.ERROR);
    expect(e.message).toBe('bucket not empty');
  });
});
