import { AbstractControl } from '@angular/forms';

import { urlValidatorExpression } from './validators';

/** Minimal control stub — the validators only read `.value`. */
const ctrl = (value: unknown) => ({ value }) as AbstractControl;

/**
 * The URL validator's path segment was rewritten from the nested `([/\w .-]*)*`
 * (catastrophic backtracking, js/redos) to a flat `[/\w .-]*` class. These cases
 * pin the accept/reject semantics and prove the linear runtime.
 */
describe('urlValidatorExpression', () => {
  it('accepts empty (delegates to required)', () => {
    expect(urlValidatorExpression(ctrl(''))).toBe(true);
    expect(urlValidatorExpression(ctrl(null))).toBe(true);
  });

  it.each([
    'example.com',
    'http://example.com',
    'https://example.com',
    'https://sub.example.com/path/to/thing',
    'https://example.co.uk/a-b_c.d/',
    'www.example.com/path with spaces',
  ])('accepts %j', (v) => {
    expect(urlValidatorExpression(ctrl(v))).toBe(true);
  });

  it.each([
    'nodot',
    'https://例え.テスト', // non-ASCII host (unchanged behaviour: rejected)
    'ht!tp://x.com',
  ])('rejects %j', (v) => {
    expect(urlValidatorExpression(ctrl(v))).toBe(false);
  });

  it('runs in linear time on a ReDoS attack string', () => {
    // The classic catastrophic input for `([/\w .-]*)*`: a long run of matching
    // path chars followed by a non-matching terminator that forces the anchored
    // `$` to fail. The flat class returns promptly.
    const evil = 'http://example.com/' + '/'.repeat(50_000) + '!';
    const start = Date.now();
    expect(urlValidatorExpression(ctrl(evil))).toBe(false);
    expect(Date.now() - start).toBeLessThan(1000);
  });
});
