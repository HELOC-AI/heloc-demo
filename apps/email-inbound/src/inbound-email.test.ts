import { inboundEmailSchema } from '@heloc/contracts';
import { describe, expect, it } from 'vitest';
import {
  BORROWER,
  encode,
  MESSAGE_ID,
  PDF_SHA256,
  PDF_SIZE,
  RECIPIENT,
  rawReply,
} from './__fixtures__/reply.ts';
import { buildInboundEmail, sha256Hex } from './inbound-email.ts';

const receivedAt = new Date('2026-09-23T04:56:42.000Z');

async function build(raw: string) {
  return buildInboundEmail({ raw: encode(raw), envelopeTo: RECIPIENT, receivedAt });
}

describe('buildInboundEmail', () => {
  it('builds an Inbound Email from a realistic reply with an attachment', async () => {
    const result = await build(rawReply());
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.email).toEqual({
      message_id: MESSAGE_ID,
      received_at: '2026-09-23T04:56:42.000Z',
      from: BORROWER,
      to: RECIPIENT,
      subject: 'Re: Additional documents required for your HELOC application',
      authentication: {
        dmarc: 'pass',
        detail: expect.stringMatching(
          /^mx\.cloudflare\.net; dkim=pass .*dmarc=pass header\.from=gmail\.com/,
        ),
      },
      attachments: [
        {
          filename: 'paystub-2026-08.pdf',
          content_type: 'application/pdf',
          size: PDF_SIZE,
          sha256: PDF_SHA256,
        },
      ],
    });
    expect(result.skippedInline).toBe(1);
    expect(inboundEmailSchema.parse(result.email)).toEqual(result.email);
    // Metadata only: no attachment content in the payload.
    expect(JSON.stringify(result.email)).not.toContain('JVBERi0');
  });

  it('keeps Cloudflare’s fail even though a forged pass sits lower in the headers', async () => {
    const result = await build(rawReply({ cloudflareDmarc: 'fail' }));
    expect(result.ok && result.email.authentication).toMatchObject({
      dmarc: 'fail',
      detail: expect.stringContaining('dmarc=fail header.from=gmail.com'),
    });
  });

  it('relies on Cloudflare always prepending its own verdict (residual trust)', async () => {
    // Without Cloudflare's header, the sender's forged copy would be the topmost one. Cloudflare
    // prepends its verdict to every message it receives (verified in production with a forged
    // copy sent through Resend: it arrived intact, below Cloudflare's), and the Worker logs how
    // many mx.cloudflare.net headers it saw so forgeries stay visible.
    const result = await build(rawReply({ cloudflareDmarc: null }));
    expect(result.ok && result.cloudflareVerdicts).toBe(1);
    const real = await build(rawReply());
    expect(real.ok && real.cloudflareVerdicts).toBe(2);
  });

  it('fails DMARC when Cloudflare evaluated a different From domain', async () => {
    const result = await build(rawReply({ cloudflareHeaderFrom: 'evil.example' }));
    expect(result.ok && result.email.authentication.dmarc).toBe('fail');
  });

  it('falls back to a sha256 of the raw message when Message-ID is missing', async () => {
    const raw = rawReply({ messageId: null });
    const result = await build(raw);
    expect(result.ok && result.email.message_id).toBe(`sha256:${await sha256Hex(encode(raw))}`);
  });

  it('reports an invalid email (paths only, no values) when From is not an address', async () => {
    const result = await build(rawReply({ from: 'undisclosed-recipients:;' }));
    expect(result).toEqual({
      ok: false,
      reason: 'invalid Inbound Email',
      issues: expect.arrayContaining([expect.stringMatching(/^from: /)]),
    });
  });

  it('returns no attachments for a plain-text reply', async () => {
    const raw = [
      'Authentication-Results: mx.cloudflare.net; dmarc=pass header.from=gmail.com',
      `From: ${BORROWER}`,
      `To: ${RECIPIENT}`,
      'Subject: Re: docs',
      '',
      'Sorry, forgot to attach.',
    ].join('\r\n');
    const result = await build(raw);
    expect(result.ok && result.email.attachments).toEqual([]);
  });
});
