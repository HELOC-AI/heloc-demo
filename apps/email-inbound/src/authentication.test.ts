import { describe, expect, it } from 'vitest';
import {
  authenticationVerdict,
  authservId,
  DETAIL_MAX_LENGTH,
  domainOf,
  type HeaderField,
  parseResults,
} from './authentication.ts';

// Captured from a real Resend → Cloudflare Email Routing delivery (probe Worker).
const REAL_CLOUDFLARE =
  'mx.cloudflare.net; dkim=pass header.d=linkerclaw.ai header.s=resend header.b=qiNreowq; ' +
  'dkim=pass header.d=amazonses.com header.s=224i4yxa5dv7c2xz3womw6peuasteono header.b=CpDNzLIT; ' +
  'dmarc=pass header.from=linkerclaw.ai policy.dmarc=none; ' +
  'spf=none (mx.cloudflare.net: no SPF records found for postmaster@a48-63.smtp-out.amazonses.com) smtp.helo=a48-63.smtp-out.amazonses.com; ' +
  'spf=pass (mx.cloudflare.net: domain of 0100@send.linkerclaw.ai designates 54.240.48.63 as permitted sender) smtp.mailfrom=0100@send.linkerclaw.ai';

const FROM = 'noreply@linkerclaw.ai';

const ar = (value: string): HeaderField => ({ key: 'authentication-results', value });
const cf = (dmarc: string, headerFrom = 'linkerclaw.ai') =>
  ar(
    `mx.cloudflare.net; dkim=pass header.d=${headerFrom}; dmarc=${dmarc} header.from=${headerFrom}`,
  );
const from = (value = FROM): HeaderField => ({ key: 'from', value });

describe('authenticationVerdict', () => {
  it('reads dmarc=pass from the real Cloudflare header and keeps it as detail', () => {
    const verdict = authenticationVerdict([ar(REAL_CLOUDFLARE), from()], FROM);
    expect(verdict).toEqual({ dmarc: 'pass', detail: REAL_CLOUDFLARE.slice(0, 499) + '…' });
    expect(verdict.detail.length).toBe(DETAIL_MAX_LENGTH);
  });

  it.each(['pass', 'fail', 'none'] as const)('maps dmarc=%s', (result) => {
    expect(authenticationVerdict([cf(result), from()], FROM).dmarc).toBe(result);
  });

  it.each(['temperror', 'permerror', 'neutral', 'policy', 'bestguesspass'])(
    'maps dmarc=%s to unknown',
    (result) => {
      expect(authenticationVerdict([cf(result), from()], FROM).dmarc).toBe('unknown');
    },
  );

  describe('only trusts the topmost mx.cloudflare.net header', () => {
    it('ignores a forged pass further down when Cloudflare said fail', () => {
      const headers = [
        cf('fail'),
        { key: 'received', value: 'from evil.example by cloudflare-email.net' },
        cf('pass'),
        from(),
      ];
      expect(authenticationVerdict(headers, FROM).dmarc).toBe('fail');
    });

    it('ignores forged copies even when there are several', () => {
      const headers = [cf('none'), cf('pass'), cf('pass'), from()];
      expect(authenticationVerdict(headers, FROM)).toMatchObject({ dmarc: 'none' });
    });

    it('ignores headers from other authserv-ids, even above Cloudflare', () => {
      const headers = [
        ar('mx.google.com; dmarc=pass header.from=linkerclaw.ai'),
        ar('mx.cloudflare.net.evil.example; dmarc=pass header.from=linkerclaw.ai'),
        cf('fail'),
        from(),
      ];
      expect(authenticationVerdict(headers, FROM).dmarc).toBe('fail');
    });

    it('ignores ARC-Authentication-Results', () => {
      const headers = [
        {
          key: 'arc-authentication-results',
          value: 'i=1; mx.cloudflare.net; dmarc=pass header.from=linkerclaw.ai',
        },
        cf('fail'),
        from(),
      ];
      expect(authenticationVerdict(headers, FROM).dmarc).toBe('fail');
    });
  });

  it('is unknown when Cloudflare added no Authentication-Results', () => {
    const verdict = authenticationVerdict(
      [ar('mx.google.com; dmarc=pass header.from=linkerclaw.ai'), from()],
      FROM,
    );
    expect(verdict).toEqual({
      dmarc: 'unknown',
      detail: 'no Authentication-Results from mx.cloudflare.net',
    });
    expect(authenticationVerdict([], FROM).dmarc).toBe('unknown');
  });

  it('is unknown when the Cloudflare header has no dmarc result', () => {
    const value = 'mx.cloudflare.net; dkim=pass header.d=linkerclaw.ai; spf=pass smtp.mailfrom=x';
    expect(authenticationVerdict([ar(value), from()], FROM)).toEqual({
      dmarc: 'unknown',
      detail: value,
    });
  });

  it('is case-insensitive for header name, authserv-id, method, result and domains', () => {
    const headers = [
      {
        key: 'Authentication-Results',
        value: 'MX.Cloudflare.NET; DKIM=pass; DMARC=PASS Header.From=LinkerClaw.AI',
      },
      { key: 'From', value: FROM },
    ];
    expect(authenticationVerdict(headers, 'NoReply@LINKERCLAW.ai').dmarc).toBe('pass');
  });

  it('uses the first dmarc result among multiple results', () => {
    const value =
      'mx.cloudflare.net; dkim=fail header.d=a.example; dkim=pass header.d=linkerclaw.ai; ' +
      'spf=softfail smtp.mailfrom=x@y.example; dmarc=pass header.from=linkerclaw.ai; ' +
      'dmarc=fail header.from=linkerclaw.ai';
    expect(authenticationVerdict([ar(value), from()], FROM).dmarc).toBe('pass');
  });

  it('ignores results hidden inside comments', () => {
    const value =
      'mx.cloudflare.net; spf=pass (looks like; dmarc=pass header.from=linkerclaw.ai) smtp.mailfrom=x; ' +
      'dmarc=fail header.from=linkerclaw.ai';
    expect(authenticationVerdict([ar(value), from()], FROM).dmarc).toBe('fail');
  });

  it('accepts an authserv-id version, folding whitespace and spaces around "="', () => {
    const value =
      'mx.cloudflare.net 1;\r\n\tdkim = pass;\r\n\tdmarc = pass header.from = linkerclaw.ai';
    expect(authenticationVerdict([ar(value), from()], FROM)).toEqual({
      dmarc: 'pass',
      detail: 'mx.cloudflare.net 1; dkim = pass; dmarc = pass header.from = linkerclaw.ai',
    });
  });

  describe('requires dmarc header.from to match the From domain', () => {
    it('fails a pass for a different domain', () => {
      const verdict = authenticationVerdict([cf('pass', 'evil.example'), from()], FROM);
      expect(verdict.dmarc).toBe('fail');
      expect(verdict.detail).toMatch(/^header\.from does not match From; mx\.cloudflare\.net;/);
    });

    it('fails a pass for a subdomain of the From domain', () => {
      expect(authenticationVerdict([cf('pass', 'mail.linkerclaw.ai'), from()], FROM).dmarc).toBe(
        'fail',
      );
    });

    it('fails when header.from is missing', () => {
      const value = 'mx.cloudflare.net; dmarc=pass policy.dmarc=none';
      expect(authenticationVerdict([ar(value), from()], FROM).dmarc).toBe('fail');
    });

    it('fails when there is no From address', () => {
      expect(authenticationVerdict([cf('pass')], undefined).dmarc).toBe('fail');
      expect(authenticationVerdict([cf('pass')], 'not-an-address').dmarc).toBe('fail');
    });

    it('fails none as well as pass on mismatch', () => {
      expect(authenticationVerdict([cf('none', 'evil.example'), from()], FROM).dmarc).toBe('fail');
    });

    it('fails when the message has more than one From header', () => {
      const headers = [cf('pass'), from(), from('attacker@evil.example')];
      const verdict = authenticationVerdict(headers, FROM);
      expect(verdict.dmarc).toBe('fail');
      expect(verdict.detail).toMatch(/^multiple From headers;/);
    });
  });

  it('truncates detail to DETAIL_MAX_LENGTH', () => {
    const long = `mx.cloudflare.net; dmarc=pass header.from=linkerclaw.ai; ${'x'.repeat(2000)}`;
    const verdict = authenticationVerdict([ar(long), from()], FROM);
    expect(verdict.dmarc).toBe('pass');
    expect(verdict.detail).toHaveLength(DETAIL_MAX_LENGTH);
  });
});

describe('parsing helpers', () => {
  it('authservId takes the first token before ";" outside comments', () => {
    expect(authservId('(c) mx.cloudflare.net 1; dmarc=pass')).toBe('mx.cloudflare.net');
    expect(authservId('  MX.CLOUDFLARE.NET;')).toBe('mx.cloudflare.net');
    expect(authservId('')).toBe('');
  });

  it('parseResults returns method, result and properties', () => {
    const [dkim, dmarc] = parseResults(
      'mx.cloudflare.net; dkim/1=pass header.d=a.example; dmarc=pass reason="x; y" header.from="linkerclaw.ai"',
    );
    expect(dkim).toMatchObject({ method: 'dkim', result: 'pass' });
    expect(dmarc?.method).toBe('dmarc');
    expect(dmarc?.props.get('reason')).toBe('x; y');
    expect(dmarc?.props.get('header.from')).toBe('linkerclaw.ai');
  });

  it('parseResults skips "none" (no results)', () => {
    expect(parseResults('mx.cloudflare.net; none')).toEqual([]);
  });

  it('domainOf lowercases and strips a trailing dot', () => {
    expect(domainOf('A@Example.COM.')).toBe('example.com');
    expect(domainOf('"a@b"@c.example')).toBe('c.example');
    expect(domainOf(undefined)).toBeUndefined();
    expect(domainOf('a@')).toBeUndefined();
  });
});
