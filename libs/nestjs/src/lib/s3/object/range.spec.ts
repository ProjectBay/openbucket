import { parseRange } from './range';

/** TEST-0307 — parseRange unit, covering the §4.3 validation table. */
describe('parseRange (TEST-0307)', () => {
  const cases: Array<[string, number, ReturnType<typeof parseRange>]> = [
    ['bytes=0-499', 1000, { start: 0, end: 499 }],
    ['bytes=500-', 1000, { start: 500, end: 999 }],
    ['bytes=-200', 1000, { start: 800, end: 999 }],
    ['bytes=999-2000', 1000, { start: 999, end: 999 }], // end clamped
    ['bytes=0-', 1000, { start: 0, end: 999 }],
    ['bytes=1000-', 1000, 'invalid'], // start past EOF
    ['bytes=0-100,200-300', 1000, 'invalid'], // multi-range
    ['bytes=', 1000, 'invalid'], // empty
    ['items=0-99', 1000, 'invalid'], // non-bytes unit
    ['bytes=foo', 1000, 'invalid'], // malformed
    ['bytes=-0', 1000, 'invalid'], // zero suffix
    ['bytes=-200', 0, 'invalid'], // suffix against empty object
    ['bytes=5-3', 1000, 'invalid'], // start > end
  ];

  it.each(cases)('parseRange(%s, %i)', (header, size, expected) => {
    expect(parseRange(header, size)).toEqual(expected);
  });
});
