import { Writable } from 'node:stream';
import { chaseEnv, loadConfig } from '@heloc/config';
import { chaseResponseSchema } from '@heloc/contracts';
import { createLogger } from '@heloc/logger';
import { UpstreamError } from '@heloc/server-kit';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from './app.ts';
import type { EmailGateway } from './application/send-chase.ts';
import type { ChaseMessage } from './domain/chase.ts';

const silent = new Writable({ write: (_c, _e, cb) => cb() });
const KEY = 'k'.repeat(64);
const auth = { authorization: `Bearer ${KEY}` };
const payload = {
  chase_id: '22222222-2222-4222-8222-222222222222',
  lead_id: '11111111-1111-4111-8111-111111111111',
  email: 'john@example.com',
  name: 'John Doe',
  missing_documents: [{ type: 'income_verification', reason: 'Income requires verification' }],
};

class FakeEmail implements EmailGateway {
  readonly sent: {
    to: string;
    message: ChaseMessage;
    key: string;
    requestId?: string | undefined;
  }[] = [];
  failWith: Error | undefined;
  async send(
    to: string,
    message: ChaseMessage,
    options: { idempotencyKey: string; requestId?: string | undefined },
  ) {
    if (this.failWith) throw this.failWith;
    this.sent.push({ to, message, key: options.idempotencyKey, requestId: options.requestId });
    return { messageId: 'email_123' };
  }
}

let app: ReturnType<typeof buildApp>;
let email: FakeEmail;
function build() {
  email = new FakeEmail();
  app = buildApp({
    config: loadConfig(chaseEnv, {
      INTERNAL_API_KEY: KEY,
      EMAIL_SERVICE_URL: 'http://email.test',
      EMAIL_SERVICE_API_KEY: KEY,
    }),
    logger: createLogger({ service: 'test', destination: silent }).logger,
    version: 'test',
    email,
  });
  return app;
}
afterEach(() => app?.close());

describe('POST /v1/chases', () => {
  it('requires the internal key', async () => {
    const res = await build().inject({ method: 'POST', url: '/v1/chases', payload });
    expect(res.statusCode).toBe(401);
  });

  it('composes and sends the Chase with a per-Chase idempotency key', async () => {
    const res = await build().inject({
      method: 'POST',
      url: '/v1/chases',
      headers: { ...auth, 'x-request-id': 'req-1' },
      payload,
    });
    expect(res.statusCode).toBe(200);
    const body = chaseResponseSchema.parse(res.json());
    expect(body).toMatchObject({
      chase_id: payload.chase_id,
      status: 'sent',
      subject: 'Additional documents required for your HELOC application',
      email_message_id: 'email_123',
    });
    expect(body.body).toContain('- Proof of income');
    expect(email.sent).toEqual([
      expect.objectContaining({
        to: 'john@example.com',
        key: `chase:${payload.chase_id}`,
        requestId: 'req-1',
      }),
    ]);
  });

  it('reports 502 when the email service is unavailable', async () => {
    build();
    email.failWith = new UpstreamError('email', 'http', 'HTTP 503', 503);
    const res = await app.inject({ method: 'POST', url: '/v1/chases', headers: auth, payload });
    expect(res.statusCode).toBe(502);
    expect(res.json().error).toBe('email_unavailable');
  });

  it('validates the request', async () => {
    const res = await build().inject({
      method: 'POST',
      url: '/v1/chases',
      headers: auth,
      payload: { ...payload, missing_documents: [] },
    });
    expect(res.statusCode).toBe(400);
  });
});
