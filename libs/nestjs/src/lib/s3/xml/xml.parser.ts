import { Injectable } from '@nestjs/common';
import { XMLParser } from 'fast-xml-parser';

import { MalformedXMLError } from '../errors/s3-error';

/**
 * XmlParser — §2.3.3 of the whitepaper.
 *
 * `fast-xml-parser@4.x` with the XXE-hardened option set: entity processing
 * off, HTML entities off, boolean attributes off, plus a `<!DOCTYPE` pre-check
 * so a malicious document can't even reach the parser. Array hints cover every
 * S3 XML element that can repeat (`Part`, `Object`, `Rule`, `CORSRule`,
 * `AllowedOrigin`, `AllowedMethod`, `AllowedHeader`, `ExposeHeader`, `Tag`,
 * `Grant`, `NoncurrentVersionTransition`, `Transition`) — `fast-xml-parser`'s
 * default would collapse a single-element list into a scalar.
 */
@Injectable()
export class XmlParser {
  private readonly parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    parseAttributeValue: true,
    parseTagValue: true,
    trimValues: true,
    processEntities: false, // XXE defence: no entity processing.
    htmlEntities: false,
    allowBooleanAttributes: false,
    // Hint arrays for elements that S3 documents repeat:
    isArray: (name) =>
      [
        'Part',
        'Object',
        'Rule',
        'CORSRule',
        'AllowedOrigin',
        'AllowedMethod',
        'AllowedHeader',
        'ExposeHeader',
        'Tag',
        'Grant',
        'NoncurrentVersionTransition',
        'Transition',
      ].includes(name),
  });

  parse(xml: string): unknown {
    if (xml.trim().length === 0) {
      throw new MalformedXMLError('empty body');
    }
    // Cheap pre-check: reject any DOCTYPE outright.
    if (/<!DOCTYPE/i.test(xml)) {
      throw new MalformedXMLError('DOCTYPE not allowed');
    }
    const parsed = this.parser.parse(xml);
    if (!parsed || typeof parsed !== 'object' || Object.keys(parsed as object).length === 0) {
      throw new MalformedXMLError('expected root element');
    }
    return parsed;
  }
}
