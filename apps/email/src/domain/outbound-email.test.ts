import { describe, expect, it } from 'vitest';
import { InvalidEmailError, outboundEmail } from './outbound-email.ts';

const valid = { to: 'john@example.com', subject: 'Hello', text: 'Hi', html: '<p>Hi</p>' };

describe('outboundEmail', () => {
  it('accepts a valid email and trims the subject', () => {
    expect(outboundEmail({ ...valid, subject: '  Hello ' })).toEqual(valid);
  });

  it.each([
    [{ to: 'nope' }, /to:/],
    [{ replyTo: 'not-an-address' }, /reply_to/],
    [{ subject: '   ' }, /subject/],
    [{ subject: 'Hi\r\nBcc: attacker@example.com' }, /single non-empty line/],
    [{ text: '' }, /bodies/],
    [{ html: ' ' }, /bodies/],
  ])('rejects %o', (overrides, message) => {
    expect(() => outboundEmail({ ...valid, ...overrides })).toThrow(InvalidEmailError);
    expect(() => outboundEmail({ ...valid, ...overrides })).toThrow(message);
  });
});
