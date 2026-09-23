import { describe, expect, it } from 'vitest';
import { REPLY_SUBJECT, replyMailto } from './chase-reply.ts';

const ADDRESS = 'reply+0b6f2a3e-8a8c-4a55-9d64-1c2f3e4d5a6b@linkerclaw.ai';

describe('replyMailto', () => {
  it('addresses the Chase reply address with the suggested subject', () => {
    expect(replyMailto(ADDRESS)).toBe(
      'mailto:reply%2B0b6f2a3e-8a8c-4a55-9d64-1c2f3e4d5a6b@linkerclaw.ai' +
        '?subject=Documents%20for%20my%20HELOC%20application',
    );
  });

  it('round-trips through URL parsing', () => {
    const url = new URL(replyMailto(ADDRESS));
    expect(decodeURIComponent(url.pathname)).toBe(ADDRESS);
    expect(url.searchParams.get('subject')).toBe(REPLY_SUBJECT);
  });

  it('accepts a custom subject', () => {
    expect(replyMailto('a@b.co', 'Hi & bye')).toBe('mailto:a@b.co?subject=Hi%20%26%20bye');
  });
});
