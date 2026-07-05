/**
 * Integration coverage for `runCli` (TEST-1201) with a mocked `fetch` and an
 * in-env token (so no login round-trip): exit codes, the client-side guards
 * (bad bucket name, malformed scope, restore `--yes` gate), the token
 * short-circuit, and the stdout(data)/stderr(error) split.
 */

import { runCli } from './index';

type FetchMock = jest.Mock<Promise<Response>, [string, RequestInit?]>;

describe('runCli commands', () => {
  const realFetch = global.fetch;
  let fetchMock: FetchMock;
  let out: string[];
  let err: string[];

  beforeEach(() => {
    process.env.OPENBUCKET_TOKEN = 'test-token';
    process.env.OPENBUCKET_ENDPOINT = 'http://127.0.0.1:3900';
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
    out = [];
    err = [];
    jest.spyOn(process.stdout, 'write').mockImplementation((c: string | Uint8Array) => {
      out.push(String(c));
      return true;
    });
    jest.spyOn(process.stderr, 'write').mockImplementation((c: string | Uint8Array) => {
      err.push(String(c));
      return true;
    });
  });

  afterEach(() => {
    global.fetch = realFetch;
    jest.restoreAllMocks();
    delete process.env.OPENBUCKET_TOKEN;
    delete process.env.OPENBUCKET_ENDPOINT;
  });

  const ok = (body: unknown, status = 200): Response =>
    new Response(status === 204 ? null : JSON.stringify(body), { status });

  it('uses the env token without a login call (buckets ls → exit 0)', async () => {
    fetchMock.mockResolvedValueOnce(ok({ buckets: [], total: 0 }));
    const code = await runCli(['buckets', 'ls']);
    expect(code).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://127.0.0.1:3900/api/admin/buckets');
    expect((init?.headers as Headers).get('Authorization')).toBe('Bearer test-token');
    // No login endpoint was hit.
    expect(url).not.toContain('/auth/login');
  });

  it('emits a single JSON document to stdout under --json', async () => {
    fetchMock.mockResolvedValueOnce(ok({ buckets: [{ name: 'a' }], total: 1 }));
    const code = await runCli(['buckets', 'ls', '--json']);
    expect(code).toBe(0);
    const joined = out.join('');
    expect(() => JSON.parse(joined)).not.toThrow();
    expect(JSON.parse(joined)).toEqual({ buckets: [{ name: 'a' }], total: 1 });
  });

  it('rejects a bad bucket name client-side and issues no request (exit 2)', async () => {
    const code = await runCli(['buckets', 'mb', 'Bad_Name']);
    expect(code).toBe(2);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(err.join('')).toMatch(/S3 naming/i);
  });

  it('rejects a malformed --scope client-side and issues no request (exit 2)', async () => {
    const code = await runCli(['keys', 'create', '--label', 'ci', '--scope', 'not-a-scope']);
    expect(code).toBe(2);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses backup restore without --yes and sends no request (exit 2)', async () => {
    const code = await runCli(['backup', 'restore', '-f', '/tmp/x.zip']);
    expect(code).toBe(2);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(err.join('')).toMatch(/--yes/);
  });

  it('maps a 401 to exit 3 with no token substring on stderr', async () => {
    fetchMock.mockResolvedValueOnce(ok({ message: 'nope' }, 401));
    const code = await runCli(['keys', 'list']);
    expect(code).toBe(3);
    expect(err.join('')).toContain('invalid credentials');
    expect(err.join('')).not.toContain('test-token');
  });

  it('maps a 429 to exit 4 and does not retry', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(null, { status: 429, headers: { 'retry-after': '5' } }),
    );
    const code = await runCli(['keys', 'list']);
    expect(code).toBe(4);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(err.join('')).toMatch(/rate limited/i);
  });

  it('prints the created secret once as data on stdout (not stderr)', async () => {
    fetchMock.mockResolvedValueOnce(
      ok({
        id: 'k1',
        accessKeyId: 'AKIA',
        secretAccessKey: 'SUPER-SECRET',
        label: 'ci',
        role: 'root',
        createdAt: '2026-01-01T00:00:00.000Z',
        scope: null,
      }),
    );
    const code = await runCli(['keys', 'create', '--label', 'ci']);
    expect(code).toBe(0);
    expect(out.join('')).toContain('SUPER-SECRET'); // secret is data on stdout
    expect(err.join('')).not.toContain('SUPER-SECRET'); // never on the error/notice stream secret-wise
    expect(err.join('')).toMatch(/not shown again/); // the notice goes to stderr
  });

  it('reports replication status even when disabled (exit 0)', async () => {
    fetchMock.mockResolvedValueOnce(
      ok({
        enabled: false,
        pendingCount: 0,
        inflightCount: 0,
        failedCount: 0,
        oldestPendingAgeMs: null,
        lastError: null,
        perBucket: [],
      }),
    );
    const code = await runCli(['replication', 'status']);
    expect(code).toBe(0);
    expect(out.join('')).toMatch(/enabled\s+no/);
  });
});
