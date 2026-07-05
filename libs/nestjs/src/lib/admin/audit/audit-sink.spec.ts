import { AuditSink } from './audit-sink';

/**
 * TEST-1103 — AuditSink (TASK-3331): normalization (column mapping incl.
 * `key`→`objectKey`), secret stripping + size cap on `detail`, and the
 * drop-oldest DoS bound.
 */
describe('AuditSink (TEST-1103)', () => {
  it('case 1: maps known catalogue keys to columns (key → objectKey)', () => {
    const sink = new AuditSink();
    sink.record({
      event: 'object.deleted',
      subject: 'admin',
      requestId: 'r1',
      bucket: 'b1',
      key: 'path/to/obj',
      ip: '127.0.0.1',
    });
    const [row] = sink.drain();
    expect(row.event).toBe('object.deleted');
    expect(row.subject).toBe('admin');
    expect(row.requestId).toBe('r1');
    expect(row.bucket).toBe('b1');
    expect(row.objectKey).toBe('path/to/obj');
    expect(row.ip).toBe('127.0.0.1');
    expect(row.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(row.ts).toBeInstanceOf(Date);
    expect(row.detail).toBeNull(); // no leftover fields
  });

  it('case 2: folds unknown fields into detail JSON', () => {
    const sink = new AuditSink();
    sink.record({ event: 'object.presigned', subject: 'a', expiresIn: 3600, extra: 'x' });
    const [row] = sink.drain();
    expect(JSON.parse(row.detail!)).toEqual({ expiresIn: 3600, extra: 'x' });
  });

  it('case 3: strips secret-like keys from detail (EPIC-08 defense-in-depth)', () => {
    const sink = new AuditSink();
    sink.record({
      event: 'x',
      subject: 'a',
      secretAccessKey: 'SHOULD_NOT_PERSIST',
      password: 'p',
      authorization: 'Bearer y',
      safe: 'keep',
    });
    const [row] = sink.drain();
    const detail = JSON.parse(row.detail!);
    expect(detail).toEqual({ safe: 'keep' });
  });

  it('case 4: drops an oversized detail payload rather than persisting it', () => {
    const sink = new AuditSink();
    sink.record({ event: 'x', subject: 'a', blob: 'z'.repeat(5000) });
    const [row] = sink.drain();
    expect(row.detail).toBeNull();
  });

  it('case 5: drop-oldest bounds the buffer and counts drops', () => {
    const sink = new AuditSink(3);
    for (let i = 0; i < 5; i++) sink.record({ event: 'e', subject: `s${i}` });
    expect(sink.size).toBe(3);
    expect(sink.takeDropped()).toBe(2);
    expect(sink.takeDropped()).toBe(0); // reset after read
    const rows = sink.drain();
    // Oldest two (s0, s1) dropped; s2..s4 retained in order.
    expect(rows.map((r) => r.subject)).toEqual(['s2', 's3', 's4']);
  });

  it('case 6: drain(max) splices at most max rows, oldest first', () => {
    const sink = new AuditSink();
    for (let i = 0; i < 4; i++) sink.record({ event: 'e', subject: `s${i}` });
    const first = sink.drain(2);
    expect(first.map((r) => r.subject)).toEqual(['s0', 's1']);
    expect(sink.size).toBe(2);
  });
});
