import { Writable } from 'node:stream';
import { emailEnv, loadConfig } from '@heloc/config';
import { sendEmailResponseSchema } from '@heloc/contracts';
import { createLogger } from '@heloc/logger';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from './app.ts';
import { ProviderError, type EmailProvider } from './application/send-email.ts';
import type { OutboundEmail } from './domain/outbound-email.ts';

const silent = new Writable({ write: (_c, _e, cb) => cb() });
const KEY = 'k'.repeat(64);
const auth = { authorization: `Bearer ${KEY}` };
const payload = {
  to: 'john@example.com',
  subject: 'Additional documents required',
  html: '<p>Hi</p>',
  text: 'Hi',
};

class FakeProvider implements EmailProvider {
  readonly name = 'fake';
  readonly sent: { email: OutboundEmail; from: string; key?: string | undefined }[] = [];
  failWith: ProviderError | undefined;
  async send(email: OutboundEmail, from: string, options: { idempotencyKey?: string | undefined }) {
    if (this.failWith) throw this.failWith;
    this.sent.push({ email, from, key: options.idempotencyKey });
    return { messageId: 'email_123' };
  }
}

let app: ReturnType<typeof buildApp>;
let provider: FakeProvider;
function build() {
  provider = new FakeProvider();
  app = buildApp({
    config: loadConfig(emailEnv, {
      INTERNAL_API_KEY: KEY,
      EMAIL_PROVIDER: 'console',
      EMAIL_FROM: 'HELOC Demo <noreply@linkerclaw.ai>',
    }),
    logger: createLogger({ service: 'test', destination: silent }).logger,
    version: 'test',
    provider,
  });
  return app;
}
afterEach(() => app?.close());

const send = (body: object = payload, headers: Record<string, string> = {}) =>
  build().inject({
    method: 'POST',
    url: '/v1/send',
    headers: { ...auth, ...headers },
    payload: body,
  });

describe('POST /v1/send', () => {
  it('requires the internal key', async () => {
    const res = await build().inject({ method: 'POST', url: '/v1/send', payload });
    expect(res.statusCode).toBe(401);
  });

  it('accepts the email, from the configured sender, with the idempotency key', async () => {
    const res = await send(
      { ...payload, reply_to: 'reply+abc@linkerclaw.ai' },
      { 'idempotency-key': 'chase:abc' },
    );
    expect(res.statusCode).toBe(202);
    expect(sendEmailResponseSchema.parse(res.json())).toEqual({
      message_id: 'email_123',
      status: 'accepted',
    });
    expect(provider.sent).toEqual([
      {
        email: { ...payload, replyTo: 'reply+abc@linkerclaw.ai' },
        from: 'HELOC Demo <noreply@linkerclaw.ai>',
        key: 'chase:abc',
      },
    ]);
  });

  it('rejects an invalid request', async () => {
    expect((await send({ ...payload, to: 'nope' })).statusCode).toBe(400);
    expect((await send({ ...payload, subject: 'a\nBcc: x@y.z' })).statusCode).toBe(400);
  });

  it('maps a provider failure to 502', async () => {
    build();
    provider.failWith = new ProviderError('daily_quota_exceeded', 'resend: quota exceeded');
    const res = await app.inject({ method: 'POST', url: '/v1/send', headers: auth, payload });
    expect(res.statusCode).toBe(502);
    expect(res.json()).toMatchObject({
      error: 'provider_error',
      details: { provider_error: 'daily_quota_exceeded' },
    });
  });
});

describe('GET /health', () => {
  it('is public', async () => {
    const res = await build().inject({ method: 'GET', url: '/health' });
    expect(res.json()).toMatchObject({ status: 'ok', service: 'email' });
  });
});
