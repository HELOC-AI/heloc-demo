import type { InboundEmail } from '@heloc/contracts';
import { describe, expect, it, vi } from 'vitest';
import { BORROWER, encode, RECIPIENT, rawReply } from './__fixtures__/reply.ts';
import { handleInboundEmail, redactAddresses, subaddressOf } from './handler.ts';
import { type ForwardOutcome, IntakeUnavailableError } from './intake-client.ts';
import type { Logger } from './log.ts';

function recordingLogger() {
  const entries: { level: string; event: string; message: string; fields: object }[] = [];
  const at =
    (level: string) =>
    (event: string, message: string, fields: object = {}) =>
      entries.push({ level, event, message, fields });
  const log: Logger = { info: at('info'), warn: at('warn'), error: at('error') };
  return { log, entries };
}

function message(raw = rawReply()) {
  const bytes = encode(raw);
  return {
    raw: bytes,
    envelopeTo: RECIPIENT,
    rawSize: bytes.byteLength,
    receivedAt: new Date('2026-09-23T04:56:42.000Z'),
  };
}

async function run(forward: (email: InboundEmail) => Promise<ForwardOutcome>, raw?: string) {
  const { log, entries } = recordingLogger();
  const forwardSpy = vi.fn(forward);
  const result = await handleInboundEmail(message(raw), { log, forward: forwardSpy }).then(
    () => ({ threw: undefined }),
    (err: unknown) => ({ threw: err }),
  );
  return { ...result, entries, forward: forwardSpy };
}

describe('handleInboundEmail', () => {
  it('forwards the Inbound Email and logs received → forwarded', async () => {
    const { threw, entries, forward } = await run(async () => ({
      kind: 'delivered',
      status: 200,
      response: { accepted: true },
    }));

    expect(threw).toBeUndefined();
    expect(forward).toHaveBeenCalledOnce();
    expect(forward.mock.calls[0]?.[0]).toMatchObject({ from: BORROWER, to: RECIPIENT });
    expect(entries.map((e) => [e.level, e.event])).toEqual([
      ['info', 'inbound.received'],
      ['info', 'inbound.forwarded'],
    ]);
    expect(entries[0]?.fields).toMatchObject({
      to_subaddress: '6f1c2d3e-4b5a-4c6d-8e7f-0a1b2c3d4e5f',
      from_domain: 'gmail.com',
      dmarc: 'pass',
      attachment_count: 1,
      attachment_bytes: 40,
      skipped_inline: 1,
      cloudflare_verdicts: 2,
    });
    expect(entries[1]?.fields).toMatchObject({ status: 200, accepted: true });
  });

  it('never logs the sender address, subject, filenames or attachment content', async () => {
    const { entries } = await run(async () => ({
      kind: 'delivered',
      status: 200,
      response: { accepted: true },
    }));
    const logged = JSON.stringify(entries).toLowerCase();
    expect(logged).not.toContain(BORROWER.toLowerCase());
    expect(logged).not.toContain('jane.doe@');
    expect(logged).not.toContain('paystub');
    expect(logged).not.toContain('additional documents');
    expect(logged).not.toContain('jvberi0');
  });

  it('logs rejected_by_intake and does not throw on a 4xx refusal', async () => {
    const { threw, entries } = await run(async () => ({
      kind: 'refused',
      status: 404,
      error: 'not_found',
      message: 'Route POST:/v1/inbound-emails not found',
    }));
    expect(threw).toBeUndefined();
    expect(entries.at(-1)).toMatchObject({
      level: 'error',
      event: 'inbound.rejected_by_intake',
      fields: { status: 404, error: 'not_found' },
    });
  });

  it('logs forward_failed and rethrows when Intake is unavailable', async () => {
    const failure = new IntakeUnavailableError('intake responded 503', 503);
    const { threw, entries } = await run(async () => {
      throw failure;
    });
    expect(threw).toBe(failure);
    expect(entries.at(-1)).toMatchObject({
      level: 'error',
      event: 'inbound.forward_failed',
      fields: { status: 503, error: 'intake responded 503' },
    });
  });

  it('drops an email that cannot become a valid Inbound Email, without forwarding', async () => {
    const { threw, entries, forward } = await run(
      async () => ({ kind: 'delivered', status: 200, response: undefined }),
      rawReply({ from: 'undisclosed-recipients:;' }),
    );
    expect(threw).toBeUndefined();
    expect(forward).not.toHaveBeenCalled();
    expect(entries).toEqual([
      expect.objectContaining({ level: 'error', event: 'inbound.invalid' }),
    ]);
  });
});

describe('helpers', () => {
  it('subaddressOf extracts the +tag', () => {
    expect(subaddressOf('reply+abc@linkerclaw.ai')).toBe('abc');
    expect(subaddressOf('reply@linkerclaw.ai')).toBeUndefined();
  });

  it('redactAddresses keeps domains only', () => {
    expect(
      redactAddresses(
        'spf=pass (domain of jane.doe@gmail.com designates) smtp.mailfrom=jane.doe@gmail.com',
      ),
    ).toBe('spf=pass (domain of *@gmail.com designates) smtp.mailfrom=*@gmail.com');
  });
});
