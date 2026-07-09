import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { readResults, record, step } from './recorder';

describe('recorder', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ob-recorder-'));
    process.env.CONFORMANCE_RESULTS_FILE = join(dir, 'results.jsonl');
  });

  afterEach(() => {
    delete process.env.CONFORMANCE_RESULTS_FILE;
    rmSync(dir, { recursive: true, force: true });
  });

  it('round-trips appended results through the JSONL sink', () => {
    record({ client: 'mc', operation: 'PutObject', status: 'pass' });
    record({ client: 'mc', operation: 'GetObject', status: 'fail', error: 'boom' });

    expect(readResults()).toEqual([
      { client: 'mc', operation: 'PutObject', status: 'pass' },
      { client: 'mc', operation: 'GetObject', status: 'fail', error: 'boom' },
    ]);
  });

  it('returns [] when no results file exists', () => {
    process.env.CONFORMANCE_RESULTS_FILE = join(dir, 'missing.jsonl');
    expect(readResults()).toEqual([]);
  });

  it('step records a pass and returns the value', async () => {
    const value = await step('aws-cli', 'CreateBucket', async () => 42);
    expect(value).toBe(42);

    const [result] = readResults();
    expect(result).toMatchObject({ client: 'aws-cli', operation: 'CreateBucket', status: 'pass' });
    expect(typeof result.durationMs).toBe('number');
  });

  it('step records a fail and re-throws so the assertion still fails', async () => {
    await expect(
      step('s3cmd', 'DeleteObject', async () => {
        throw new Error('nope');
      }),
    ).rejects.toThrow('nope');

    const [result] = readResults();
    expect(result).toMatchObject({
      client: 's3cmd',
      operation: 'DeleteObject',
      status: 'fail',
      error: 'nope',
    });
  });
});
