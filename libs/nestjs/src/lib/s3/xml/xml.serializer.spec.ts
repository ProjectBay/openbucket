import { XmlSerializer } from './xml.serializer';

/**
 * TEST-0102 — XmlSerializer unit (cases 4-5).
 */
describe('XmlSerializer (TEST-0102 cases 4-5)', () => {
  const serializer = new XmlSerializer();

  // ---------- case 4: canonical S3 envelope ------------------------------

  it('case 4: serializes { Foo: "bar" } with root "Result" into the S3 envelope', () => {
    const out = serializer.serialize('Result', { Foo: 'bar' });
    expect(out).toBe(
      `<?xml version="1.0" encoding="UTF-8"?>` +
        `<Result xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Foo>bar</Foo></Result>`,
    );
  });

  // ---------- case 5: __root / __raw stripped ----------------------------

  it('case 5: __root and __raw keys are stripped from the output (nested too)', () => {
    const out = serializer.serialize('ListBucketResult', {
      __root: 'ListBucketResult', // top-level hint
      __raw: false,
      Name: 'b',
      Contents: [
        { __root: 'Object', Key: 'a' }, // nested hints
        { __raw: true, Key: 'b' },
      ],
    });
    expect(out).not.toMatch(/__root/);
    expect(out).not.toMatch(/__raw/);
    expect(out).toMatch(/<Name>b<\/Name>/);
    expect(out).toMatch(/<Key>a<\/Key>/);
    expect(out).toMatch(/<Key>b<\/Key>/);
  });

  it('emits the xmlns declaration on whichever root is named', () => {
    const out = serializer.serialize('ListBucketResult', { Name: 'b' });
    expect(out).toContain(
      `<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">`,
    );
  });
});
