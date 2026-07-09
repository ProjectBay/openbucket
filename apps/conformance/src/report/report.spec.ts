import {
  buildReport,
  renderMarkdown,
  type ConformanceMetadata,
  type ConformanceResult,
} from './report';

const META: ConformanceMetadata = {
  image: 'openbucket:sha-abc1234',
  generatedAt: '2026-07-09T12:00:00.000Z',
  suite: 'openbucket-conformance',
  clientVersions: {
    '@aws-sdk/client-s3': '3.600.0',
    'aws CLI': '2.15.0',
  },
};

const RESULTS: ConformanceResult[] = [
  { client: 'aws-cli', operation: 'PutObject', status: 'pass' },
  { client: 'aws-sdk-js', operation: 'CreateBucket', status: 'pass' },
  { client: 'aws-cli', operation: 'CreateBucket', status: 'pass' },
  { client: 'aws-sdk-js', operation: 'PutObject', status: 'pass' },
  { client: 'aws-cli', operation: 'GetObject', status: 'fail', error: 'byte mismatch' },
];

describe('buildReport', () => {
  it('computes a summary and sorts results by operation then client column order', () => {
    const report = buildReport(RESULTS, META);

    expect(report.metadata).toEqual(META);
    expect(report.summary).toEqual({ total: 5, pass: 4, fail: 1, skip: 0 });

    // CreateBucket rows first (sorted alpha), aws-sdk-js before aws-cli (column order).
    expect(report.results.slice(0, 2)).toEqual([
      { client: 'aws-sdk-js', operation: 'CreateBucket', status: 'pass' },
      { client: 'aws-cli', operation: 'CreateBucket', status: 'pass' },
    ]);
  });

  it('collapses duplicate (client × operation) with worst-status-wins', () => {
    const report = buildReport(
      [
        { client: 'mc', operation: 'PutObject', status: 'pass' },
        { client: 'mc', operation: 'PutObject', status: 'fail', error: 'flaked' },
      ],
      META,
    );

    expect(report.results).toHaveLength(1);
    expect(report.results[0]).toMatchObject({ status: 'fail', error: 'flaked' });
    expect(report.summary).toEqual({ total: 1, pass: 0, fail: 1, skip: 0 });
  });

  it('produces a JSON-round-trippable artifact', () => {
    const report = buildReport(RESULTS, META);
    expect(JSON.parse(JSON.stringify(report))).toEqual(report);
  });
});

describe('renderMarkdown', () => {
  it('renders provenance, a matrix, and failures', () => {
    const md = renderMarkdown(buildReport(RESULTS, META));

    expect(md).toContain('# S3 conformance report');
    expect(md).toContain('`openbucket:sha-abc1234`');
    expect(md).toContain('2026-07-09T12:00:00.000Z');
    expect(md).toContain('**Result:** 4/5 passed');
    expect(md).toContain('**1 failed**');

    // Matrix header only includes clients that produced results.
    expect(md).toContain('| Operation | @aws-sdk/client-s3 | aws CLI |');
    expect(md).not.toContain('MinIO mc');

    // Pass/fail symbols in the matrix.
    expect(md).toMatch(/\| GetObject \|.*❌ \|/);
    expect(md).toMatch(/\| CreateBucket \|.*✅ \|.*✅ \|/);

    // Failure detail is surfaced.
    expect(md).toContain('**aws CLI · GetObject** — byte mismatch');

    // Client versions section.
    expect(md).toContain('**aws CLI:** 2.15.0');
  });

  it('handles an empty run without throwing', () => {
    const md = renderMarkdown(buildReport([], { ...META, clientVersions: {} }));
    expect(md).toContain('_No results were recorded for this run._');
  });
});
