import { Injectable } from '@nestjs/common';
import { XMLBuilder } from 'fast-xml-parser';

const XML_NS = 'http://s3.amazonaws.com/doc/2006-03-01/';

/**
 * XmlSerializer — §2.3.4 of the whitepaper.
 *
 * Wraps a POJO as `<?xml version="1.0" encoding="UTF-8"?><RootName
 * xmlns="http://s3.amazonaws.com/doc/2006-03-01/">…</RootName>`. Internal
 * hints (`__root`, `__raw`) used by the `XmlInterceptor` to decide envelope
 * shape are stripped before building so they never appear on the wire.
 */
@Injectable()
export class XmlSerializer {
  private readonly builder = new XMLBuilder({
    attributeNamePrefix: '@_',
    ignoreAttributes: false,
    format: false, // S3 wire format isn't pretty-printed.
    suppressEmptyNode: false,
    processEntities: true,
    suppressBooleanAttributes: false,
  });

  serialize(rootName: string, value: unknown): string {
    // Strip internal hints before building.
    const cleaned = this.stripInternals(value);
    const doc = {
      '?xml': { '@_version': '1.0', '@_encoding': 'UTF-8' },
      [rootName]: {
        '@_xmlns': XML_NS,
        ...(cleaned as object),
      },
    };
    return this.builder.build(doc);
  }

  private stripInternals(v: unknown): unknown {
    if (Array.isArray(v)) return v.map((x) => this.stripInternals(x));
    if (v && typeof v === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, val] of Object.entries(v)) {
        if (k === '__root' || k === '__raw') continue;
        out[k] = this.stripInternals(val);
      }
      return out;
    }
    return v;
  }
}
