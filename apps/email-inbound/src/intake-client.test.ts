import type { InboundEmail } from '@heloc/contracts';
import { describe, expect, it } from 'vitest';
import { forwardInboundEmail, IntakeUnavailableError } from './intake-client.ts';

const EMAIL: InboundEmail = {
  message_id: '<m1@mail.gmail.com>',
  received_at: '2026-09-23T04:56:42.000Z',
  from: 'jane@gmail.com',
  to: 'reply+6f1c2d3e-4b5a-4c6d-8e7f-0a1b2c3d4e5f@linkerclaw.ai',
  subject: 'Re: docs',
  authentication: { dmarc: 'pass', detail: 'mx.cloudflare.net; dmarc=pass header.from=gmail.com' },
  attachments: [
    { filename: 'a.pdf', content_type: 'application/pdf', size: 3, sha256: 'a'.repeat(64) },
  ],
};

interface Call {
  url: string;
  init: RequestInit;
}

function fakeFetch(respond: (call: Call) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const fetch = (async (url: string, init: RequestInit) => {
    const call = { url, init };
    calls.push(call);
    return respond(call);
  }) as unknown as typeof globalThis.fetch;
  return { fetch, calls };
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const options = (fetch: typeof globalThis.fetch) => ({
  baseUrl: 'https://intake.example/',
  apiKey: 'test-key',
  fetch,
});

describe('forwardInboundEmail', () => {
  it('POSTs the Inbound Email with bearer auth and x-request-id', async () => {
    const { fetch, calls } = fakeFetch(() =>
      json(200, { accepted: true, lead_id: '6f1c2d3e-4b5a-4c6d-8e7f-0a1b2c3d4e5f' }),
    );
    const outcome = await forwardInboundEmail(EMAIL, 'req-1', options(fetch));

    expect(outcome).toEqual({
      kind: 'delivered',
      status: 200,
      response: { accepted: true, lead_id: '6f1c2d3e-4b5a-4c6d-8e7f-0a1b2c3d4e5f' },
    });
    expect(calls).toHaveLength(1);
    const [call] = calls;
    expect(call?.url).toBe('https://intake.example/v1/inbound-emails');
    expect(call?.init.method).toBe('POST');
    expect(call?.init.headers).toMatchObject({
      authorization: 'Bearer test-key',
      'content-type': 'application/json',
      'x-request-id': 'req-1',
    });
    expect(JSON.parse(call?.init.body as string)).toEqual(EMAIL);
    expect(call?.init.signal).toBeInstanceOf(AbortSignal);
  });

  it('treats accepted=false as delivered (Intake decided)', async () => {
    const { fetch } = fakeFetch(() => json(200, { accepted: false, reason: 'not_a_chase_reply' }));
    await expect(forwardInboundEmail(EMAIL, 'r', options(fetch))).resolves.toMatchObject({
      kind: 'delivered',
      response: { accepted: false, reason: 'not_a_chase_reply' },
    });
  });

  it('tolerates a 2xx body that does not match the contract', async () => {
    const { fetch } = fakeFetch(() => new Response('ok', { status: 202 }));
    await expect(forwardInboundEmail(EMAIL, 'r', options(fetch))).resolves.toEqual({
      kind: 'delivered',
      status: 202,
      response: undefined,
    });
  });

  it.each([400, 409, 413, 422])('returns refused (no retry) on %i', async (status) => {
    const { fetch } = fakeFetch(() =>
      json(status, { error: 'bad_request', message: 'x'.repeat(1000), details: { from: 'pii' } }),
    );
    const outcome = await forwardInboundEmail(EMAIL, 'r', options(fetch));
    expect(outcome).toEqual({
      kind: 'refused',
      status,
      error: 'bad_request',
      message: 'x'.repeat(300),
    });
  });

  it('returns refused with no details when the 4xx body is not JSON', async () => {
    const { fetch } = fakeFetch(() => new Response('Bad Request', { status: 400 }));
    await expect(forwardInboundEmail(EMAIL, 'r', options(fetch))).resolves.toEqual({
      kind: 'refused',
      status: 400,
      error: undefined,
      message: undefined,
    });
  });

  it.each([500, 502, 503, 504, 401, 403, 404, 408, 429])('throws (retry) on %i', async (status) => {
    const { fetch } = fakeFetch(() => json(status, { error: 'x', message: 'y' }));
    const error = await forwardInboundEmail(EMAIL, 'r', options(fetch)).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(IntakeUnavailableError);
    expect(error).toMatchObject({ status, message: `intake responded ${status}` });
  });

  it('throws (retry) on a network error', async () => {
    const { fetch } = fakeFetch(() => {
      throw new TypeError('fetch failed');
    });
    await expect(forwardInboundEmail(EMAIL, 'r', options(fetch))).rejects.toThrow(
      new IntakeUnavailableError('intake unreachable (TypeError: fetch failed)'),
    );
  });

  it('throws (retry) when Intake does not answer within the timeout', async () => {
    const { fetch } = fakeFetch(
      ({ init }) =>
        new Promise<Response>((_, reject) => {
          init.signal?.addEventListener('abort', () => reject(init.signal?.reason));
        }),
    );
    const error = await forwardInboundEmail(EMAIL, 'r', { ...options(fetch), timeoutMs: 20 }).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(IntakeUnavailableError);
    expect((error as Error).message).toMatch(/^intake unreachable \(TimeoutError/);
  });
});
