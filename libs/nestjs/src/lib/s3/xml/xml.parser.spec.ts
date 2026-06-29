import { MalformedXMLError } from '../errors/s3-error';
import { XmlParser } from './xml.parser';

/**
 * TEST-0102 — XmlParser unit (cases 1–3).
 */
describe('XmlParser (TEST-0102 cases 1-3)', () => {
  const parser = new XmlParser();

  // ---------- case 1: DOCTYPE / XXE defence ------------------------------

  it('case 1: rejects any document containing <!DOCTYPE', () => {
    const xml = `<!DOCTYPE foo [ <!ENTITY x SYSTEM "file:///etc/passwd"> ]><root/>`;
    expect(() => parser.parse(xml)).toThrow(MalformedXMLError);
    try {
      parser.parse(xml);
    } catch (e) {
      expect((e as MalformedXMLError).message).toMatch(/DOCTYPE not allowed/);
    }
  });

  it('case 1b: DOCTYPE check is case-insensitive (e.g. <!doctype>)', () => {
    expect(() => parser.parse(`<!doctype html><root/>`)).toThrow(MalformedXMLError);
  });

  // ---------- case 2: array hint with one element ------------------------

  it('case 2: <CompleteMultipartUpload> with a single <Part> still parses Part as an array', () => {
    const xml =
      `<CompleteMultipartUpload>` +
      `<Part><PartNumber>1</PartNumber><ETag>e</ETag></Part>` +
      `</CompleteMultipartUpload>`;
    const parsed = parser.parse(xml) as {
      CompleteMultipartUpload: { Part: Array<{ PartNumber: number; ETag: string }> };
    };
    expect(Array.isArray(parsed.CompleteMultipartUpload.Part)).toBe(true);
    expect(parsed.CompleteMultipartUpload.Part).toHaveLength(1);
    expect(parsed.CompleteMultipartUpload.Part[0]).toEqual({ PartNumber: 1, ETag: 'e' });
  });

  // ---------- case 3: every element in the array-hint list ---------------

  // rootPath segments matching `^\d+$` index into arrays (necessary when the
  // parent element is also in the isArray hint list — e.g. `CORSRule` wraps to
  // `parsed.CORSRule[0]` so children live under `.0`).
  it.each([
    ['Object', `<ListBucketResult><Object><Key>k</Key></Object></ListBucketResult>`, 'ListBucketResult'],
    ['Rule', `<LifecycleConfiguration><Rule><ID>r</ID></Rule></LifecycleConfiguration>`, 'LifecycleConfiguration'],
    ['CORSRule', `<CORSConfiguration><CORSRule><ID>c</ID></CORSRule></CORSConfiguration>`, 'CORSConfiguration'],
    ['AllowedOrigin', `<CORSRule><AllowedOrigin>*</AllowedOrigin></CORSRule>`, 'CORSRule.0'],
    ['AllowedMethod', `<CORSRule><AllowedMethod>GET</AllowedMethod></CORSRule>`, 'CORSRule.0'],
    ['AllowedHeader', `<CORSRule><AllowedHeader>X-A</AllowedHeader></CORSRule>`, 'CORSRule.0'],
    ['ExposeHeader', `<CORSRule><ExposeHeader>X-A</ExposeHeader></CORSRule>`, 'CORSRule.0'],
    ['Tag', `<Tagging><TagSet><Tag><Key>k</Key><Value>v</Value></Tag></TagSet></Tagging>`, 'Tagging.TagSet'],
    ['Grant', `<AccessControlList><Grant><Permission>READ</Permission></Grant></AccessControlList>`, 'AccessControlList'],
    [
      'NoncurrentVersionTransition',
      `<Rule><NoncurrentVersionTransition><Days>30</Days></NoncurrentVersionTransition></Rule>`,
      'Rule.0',
    ],
    ['Transition', `<Rule><Transition><Days>30</Days></Transition></Rule>`, 'Rule.0'],
  ])('case 3: %s parses as an array when there is exactly one', (element, xml, rootPath) => {
    const parsed = parser.parse(xml) as Record<string, unknown>;
    const node = rootPath.split('.').reduce<unknown>((acc, k) => {
      if (Array.isArray(acc) && /^\d+$/.test(k)) return acc[Number(k)];
      return (acc as Record<string, unknown>)[k];
    }, parsed);
    const value = (node as Record<string, unknown>)[element];
    expect(Array.isArray(value)).toBe(true);
    expect(value).toHaveLength(1);
  });

  // ---------- sanity: rejects non-XML / empty ----------------------------

  it('rejects an empty/non-XML body with MalformedXMLError', () => {
    expect(() => parser.parse('')).toThrow(MalformedXMLError);
  });
});
