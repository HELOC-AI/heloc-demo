import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProviderError } from '../application/send-email.ts';
import { ResendProvider } from './resend-provider.ts';

const email = { to: 'john@example.com', subject: 'Hello', text: 'Hi', html: '<p>Hi</p>' };

afterEach(() => vi.unstubAllGlobals());

function stubFetch(status: number, body: object) {
  const fetchMock = vi.fn(
    async () =>
      new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('ResendProvider', () => {
  it('sends with the sender and forwards the idempotency key', async () => {
    const fetchMock = stubFetch(200, { id: 'email_123' });
    const receipt = await new ResendProvider('re_test').send(
      email,
      'HELOC <noreply@linkerclaw.ai>',
      {
        idempotencyKey: 'chase:abc',
      },
    );
    expect(receipt).toEqual({ messageId: 'email_123' });

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.resend.com/emails');
    const headers = new Headers(init.headers);
    expect(headers.get('idempotency-key')).toBe('chase:abc');
    expect(headers.get('authorization')).toBe('Bearer re_test');
    expect(JSON.parse(String(init.body))).toMatchObject({
      from: 'HELOC <noreply@linkerclaw.ai>',
      to: ['john@example.com'],
      subject: 'Hello',
      text: 'Hi',
      html: '<p>Hi</p>',
    });
  });

  it('turns a Resend error into a ProviderError', async () => {
    stubFetch(403, { name: 'validation_error', message: 'domain not verified', statusCode: 403 });
    const send = new ResendProvider('re_test').send(email, 'x@example.com', {});
    await expect(send).rejects.toBeInstanceOf(ProviderError);
    await expect(send).rejects.toThrow('resend: domain not verified');
  });
});
