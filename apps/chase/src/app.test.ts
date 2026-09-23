import { Writable } from 'node:stream';
import { chaseEnv, loadConfig } from '@heloc/config';
import { chaseResponseSchema, outcomeNoticeResponseSchema } from '@heloc/contracts';
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
    replyTo?: string | undefined;
    requestId?: string | undefined;
  }[] = [];
  failWith: Error | undefined;
  async send(
    to: string,
    message: ChaseMessage,
    options: {
      idempotencyKey: string;
      replyTo?: string | undefined;
      requestId?: string | undefined;
    },
  ) {
    if (this.failWith) throw this.failWith;
    this.sent.push({
      to,
      message,
      key: options.idempotencyKey,
      replyTo: options.replyTo,
      requestId: options.requestId,
    });
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
      CHASE_REPLY_ADDRESS: 'reply@linkerclaw.ai',
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
      reply_to: `reply+${payload.chase_id}@linkerclaw.ai`,
    });
    expect(body.body).toContain('- Proof of income');
    expect(email.sent).toEqual([
      expect.objectContaining({
        to: 'john@example.com',
        key: `chase:${payload.chase_id}`,
        replyTo: `reply+${payload.chase_id}@linkerclaw.ai`,
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

describe('POST /v1/outcome-notices', () => {
  const notice = {
    notice_id: '33333333-3333-4333-8333-333333333333',
    lead_id: payload.lead_id,
    email: 'john@example.com',
    name: 'John Doe',
    outcome: {
      status: 'approved',
      offer: {
        lender: 'Figure mock',
        amount: 250_000,
        apr_min: 7.5,
        apr_max: 9.5,
        term_months: 120,
        estimated_monthly_payment: 2_968,
        expires_at: '2026-10-23T00:00:00.000Z',
      },
    },
    result_url: 'https://heloc-demo.vercel.app/result/' + payload.lead_id,
  };

  it('sends the notice once per notice id, without a reply address', async () => {
    const res = await build().inject({
      method: 'POST',
      url: '/v1/outcome-notices',
      headers: auth,
      payload: notice,
    });
    expect(res.statusCode).toBe(200);
    expect(outcomeNoticeResponseSchema.parse(res.json())).toMatchObject({
      notice_id: notice.notice_id,
      status: 'sent',
      subject: 'Your HELOC offer is ready',
    });
    expect(email.sent[0]).toMatchObject({
      to: 'john@example.com',
      key: `notice:${notice.notice_id}`,
      replyTo: undefined,
    });
  });

  it('words the email for the step that decided: document review by default', async () => {
    const app = build();
    const send = (payload: object) =>
      app.inject({ method: 'POST', url: '/v1/outcome-notices', headers: auth, payload });

    expect((await send(notice)).statusCode).toBe(200);
    expect((await send({ ...notice, basis: 'prequalification' })).statusCode).toBe(200);
    expect(email.sent[0]?.message.text).toContain('We have reviewed them');
    expect(email.sent[1]?.message.text).toContain("you're prequalified");
    expect(email.sent[1]?.message.text).toContain(notice.result_url);
  });

  it('rejects an unknown basis', async () => {
    const res = await build().inject({
      method: 'POST',
      url: '/v1/outcome-notices',
      headers: auth,
      payload: { ...notice, basis: 'gut_feeling' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects an unknown rejection reason', async () => {
    const res = await build().inject({
      method: 'POST',
      url: '/v1/outcome-notices',
      headers: auth,
      payload: { ...notice, outcome: { status: 'rejected', reason: 'bad_vibes' } },
    });
    expect(res.statusCode).toBe(400);
  });
});
