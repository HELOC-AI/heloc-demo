import { Writable } from 'node:stream';
import { PGlite } from '@electric-sql/pglite';
import { intakeEnv, loadConfig } from '@heloc/config';
import {
  HEADERS,
  inboundEmailResponseSchema,
  leadResultSchema,
  opsLeadsResponseSchema,
  SUBMISSION_ERRORS,
} from '@heloc/contracts';
import { createLogger } from '@heloc/logger';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from './app.ts';
import type { PrequalDecision } from './domain/model.ts';
import {
  DrizzleLeadRepository,
  type Database,
} from './infrastructure/db/drizzle-lead-repository.ts';
import * as schema from './infrastructure/db/schema.ts';
import { FakeChases, FakeNotices, FakePrequal } from './testing/fakes.ts';

const silent = new Writable({ write: (_c, _e, cb) => cb() });
const key = 'k'.repeat(64);
const WEB = 'https://heloc-demo.vercel.app';
const INBOUND_KEY = 'i'.repeat(64);
const OPS_KEY = 'o'.repeat(64);

const approved: PrequalDecision = {
  outcome: 'approved',
  offer: {
    lender: 'Figure mock',
    amount: 150_000,
    aprMin: 7.5,
    aprMax: 9.5,
    termMonths: 120,
    estimatedMonthlyPayment: 1_780,
    expiresAt: new Date('2026-10-01T00:00:00Z'),
  },
};
const needDocs: PrequalDecision = {
  outcome: 'need_more_documents',
  missingDocuments: [{ type: 'income_verification', reason: 'Income requires verification' }],
};

const quiz = {
  name: 'John Doe',
  email: 'john@example.com',
  phone: '(415) 555-1234',
  property_state: 'CA',
  estimated_home_value: 800_000,
  mortgage_balance: 350_000,
  credit_band: '700-739',
  income_band: '150k-200k',
  purpose: 'home_improvement',
};

let app: ReturnType<typeof buildApp>;
let prequal: FakePrequal;
let chases: FakeChases;
let notices: FakeNotices;
let background: Promise<unknown>[] = [];
let pingFails = false;
let db: Database;

async function build({ allowMockOverride = true } = {}) {
  const pg = new PGlite();
  await migrate(drizzle(pg), { migrationsFolder: new URL('../drizzle', import.meta.url).pathname });
  db = drizzle(pg, { schema }) as unknown as Database;
  app = buildApp({
    config: loadConfig(intakeEnv, {
      DATABASE_URL: 'postgresql://unused:unused@localhost:5432/unused',
      FIGURE_API_URL: 'http://figure.test',
      FIGURE_API_KEY: key,
      CHASE_API_URL: 'http://chase.test',
      CHASE_API_KEY: key,
      CORS_ORIGINS: WEB,
      ALLOW_MOCK_OVERRIDE: String(allowMockOverride),
      WEB_APP_URL: WEB,
      INBOUND_API_KEY: INBOUND_KEY,
      OPS_API_KEY: OPS_KEY,
    }),
    logger: createLogger({ service: 'test', destination: silent }).logger,
    version: 'test',
    store: new DrizzleLeadRepository(db),
    pingDatabase: async () => {
      if (pingFails) throw new Error('db down');
    },
    prequal,
    chases,
    notices,
    onBackground: (work) => background.push(work),
  });
  return app;
}

beforeEach(() => {
  prequal = new FakePrequal(approved);
  chases = new FakeChases();
  notices = new FakeNotices();
  background = [];
  pingFails = false;
});
afterEach(() => app?.close());

const submit = async (payload: object = quiz, headers: Record<string, string> = {}) => {
  await build();
  return app.inject({ method: 'POST', url: '/v1/leads', payload, headers });
};

describe('GET /health', () => {
  it('reports the database check', async () => {
    await build();
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.json()).toMatchObject({ status: 'ok', service: 'intake', checks: { db: 'ok' } });
  });

  it('is degraded (503) when the database is down', async () => {
    pingFails = true;
    await build();
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(503);
    expect(res.json().checks).toEqual({ db: 'fail' });
  });
});

describe('POST /v1/leads', () => {
  it('creates an approved Lead with its offer', async () => {
    const res = await submit();
    expect(res.statusCode).toBe(201);
    const body = leadResultSchema.parse(res.json());
    expect(body).toMatchObject({
      status: 'approved',
      offer: { amount: 150_000, apr_min: 7.5, expires_at: '2026-10-01T00:00:00.000Z' },
      notice: { status: 'sent' },
    });
    expect(body.events?.map((e) => e.type)).toEqual([
      'lead.created',
      'figure.requested',
      'figure.approved',
      'notice.created',
      'notice.sent',
    ]);
    expect(notices.calls[0]).toMatchObject({
      basis: 'prequalification',
      resultUrl: `${WEB}/result/${body.lead_id}`,
    });
  });

  it('answers 502 with the offer when only the outcome email failed', async () => {
    notices.failWith = new Error('chase: HTTP 503');
    const res = await submit();
    expect(res.statusCode).toBe(502);
    expect(leadResultSchema.parse(res.json())).toMatchObject({
      status: 'failed',
      failed_step: 'notify',
      offer: { amount: 150_000 },
      notice: { status: 'failed' },
    });
  });

  it('chases a Need More Documents Lead and reports the documents', async () => {
    prequal.next = needDocs;
    const res = await submit();
    expect(res.statusCode).toBe(201);
    expect(leadResultSchema.parse(res.json())).toMatchObject({
      status: 'chase_sent',
      documents: needDocs.missingDocuments,
      chase: { status: 'sent' },
    });
    expect(chases.calls[0]).toMatchObject({ borrowerEmail: 'john@example.com' });
  });

  it('stores the phone number normalized to E.164', async () => {
    await submit();
    const [row] = await db.select({ phone: schema.leads.phone }).from(schema.leads);
    expect(row?.phone).toBe('+14155551234');
  });

  it('rejects invalid borrower data with field details', async () => {
    const res = await submit({ ...quiz, email: 'nope', mortgage_balance: -5 });
    expect(res.statusCode).toBe(400);
    expect(res.json().details.map((d: { path: string }) => d.path)).toEqual([
      'email',
      'mortgage_balance',
    ]);
    expect(prequal.calls).toHaveLength(0);
  });

  it('returns 502 with the reason when Prequalification is down, and persists the Lead', async () => {
    prequal.next = new Error('figure-mock: timed out after 5000ms');
    const res = await submit();
    expect(res.statusCode).toBe(502);
    const body = leadResultSchema.parse(res.json());
    expect(body).toMatchObject({ status: 'failed', error: 'figure-mock: timed out after 5000ms' });

    const stored = await app.inject({ method: 'GET', url: `/v1/leads/${body.lead_id}` });
    expect(stored.json().status).toBe('failed');
  });

  it('passes X-Mock-Outcome / X-Mock-Fault through when allowed', async () => {
    await submit(quiz, { 'x-mock-outcome': 'need-more-documents', 'x-mock-fault': 'timeout' });
    expect(prequal.calls[0]?.context.scenario).toEqual({
      forcedOutcome: 'need_more_documents',
      fault: 'timeout',
    });
  });

  it('ignores the mock headers when not allowed', async () => {
    await build({ allowMockOverride: false });
    await app.inject({
      method: 'POST',
      url: '/v1/leads',
      payload: quiz,
      headers: { 'x-mock-outcome': 'rejected' },
    });
    expect(prequal.calls[0]?.context.scenario).toBeUndefined();
  });

  it('rejects an unknown mock outcome', async () => {
    const res = await submit(quiz, { 'x-mock-outcome': 'maybe' });
    expect(res.statusCode).toBe(400);
  });
});

describe('POST /v1/leads/:id/replay', () => {
  it('recovers a failed Chase without re-pulling the decision', async () => {
    prequal.next = needDocs;
    chases.failWith = new Error('chase: HTTP 503');
    const failed = await submit();
    expect(failed.statusCode).toBe(502);
    chases.failWith = undefined;

    const res = await app.inject({
      method: 'POST',
      url: `/v1/leads/${failed.json().lead_id}/replay`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'chase_sent', chase: { status: 'sent' } });
    expect(prequal.calls).toHaveLength(1);
    expect(chases.delivered.size).toBe(1);
  });

  it('404s for an unknown Lead', async () => {
    await build();
    const res = await app.inject({
      method: 'POST',
      url: '/v1/leads/33333333-3333-4333-8333-333333333333/replay',
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe('lead_not_found');
  });
});

describe('GET /v1/leads/:id', () => {
  it('returns the Lead with its timeline', async () => {
    const created = (await submit()).json();
    const res = await app.inject({ method: 'GET', url: `/v1/leads/${created.lead_id}` });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(created);
  });

  it('404s for malformed ids', async () => {
    await build();
    const res = await app.inject({ method: 'GET', url: '/v1/leads/not-a-uuid' });
    expect(res.statusCode).toBe(404);
  });
});

describe('CORS', () => {
  const preflight = (origin: string) =>
    app.inject({
      method: 'OPTIONS',
      url: '/v1/leads',
      headers: {
        origin,
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'content-type,x-mock-outcome',
      },
    });

  it('allows the web origin, including the demo header', async () => {
    await build();
    const res = await preflight(WEB);
    expect(res.headers['access-control-allow-origin']).toBe(WEB);
    expect(String(res.headers['access-control-allow-headers'])).toContain('x-mock-outcome');
  });

  it('does not allow other origins', async () => {
    await build();
    const res = await preflight('https://evil.example');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });
});

describe('POST /v1/inbound-emails', () => {
  const inbound = (chaseId: string, overrides: Record<string, unknown> = {}) => ({
    message_id: '<reply-1@mail.example.com>',
    received_at: '2026-09-23T01:00:00.000Z',
    from: 'john@example.com',
    to: `reply+${chaseId}@linkerclaw.ai`,
    subject: 'Re: Additional documents required for your HELOC application',
    authentication: {
      dmarc: 'pass',
      detail: 'mx.cloudflare.net; dmarc=pass header.from=example.com',
    },
    attachments: [
      {
        filename: 'paystub.pdf',
        content_type: 'application/pdf',
        size: 1234,
        sha256: 'a'.repeat(64),
      },
    ],
    ...overrides,
  });
  const post = (payload: object, key = INBOUND_KEY) =>
    app.inject({
      method: 'POST',
      url: '/v1/inbound-emails',
      headers: { authorization: `Bearer ${key}` },
      payload,
    });

  async function chased() {
    prequal.next = needDocs;
    const created = (await submit()).json();
    const chaseId = /reply\+([0-9a-f-]{36})@/.exec(created.chase.reply_to)![1]!;
    return { leadId: created.lead_id as string, chaseId, created };
  }

  it('shows the borrower where to reply, with their email masked', async () => {
    const { created } = await chased();
    expect(created.chase).toMatchObject({
      status: 'sent',
      sent_to: 'j***@example.com',
      reply_to: expect.stringMatching(/^reply\+[0-9a-f-]{36}@linkerclaw\.ai$/),
    });
  });

  it('only accepts the inbound adapter key', async () => {
    const { chaseId } = await chased();
    expect((await post(inbound(chaseId), 'x'.repeat(64))).statusCode).toBe(401);
    expect((await post(inbound(chaseId), key)).statusCode).toBe(401); // another hop's key
  });

  it('accepts a Chase Reply and completes review + notice in the background', async () => {
    const { leadId, chaseId } = await chased();
    const res = await post(inbound(chaseId));
    expect(res.statusCode).toBe(202);
    expect(inboundEmailResponseSchema.parse(res.json())).toEqual({
      accepted: true,
      lead_id: leadId,
    });

    await Promise.all(background);
    const result = leadResultSchema.parse(
      (await app.inject({ method: 'GET', url: `/v1/leads/${leadId}` })).json(),
    );
    expect(result).toMatchObject({
      status: 'approved',
      offer: { amount: 250_000 },
      documents_received: {
        received_at: '2026-09-23T01:00:00.000Z',
        attachments: [{ filename: 'paystub.pdf', content_type: 'application/pdf', size: 1234 }],
      },
      notice: { status: 'sent' },
    });
    expect(notices.calls[0]?.resultUrl).toBe(`${WEB}/result/${leadId}`);
  });

  it.each([
    [{ authentication: { dmarc: 'fail', detail: 'dmarc=fail' } }, 'not_authenticated'],
    [{ from: 'attacker@example.com' }, 'sender_mismatch'],
    [{ attachments: [] }, 'no_attachments'],
  ])('refuses %o as %s', async (overrides, reason) => {
    const { leadId, chaseId } = await chased();
    const res = await post(inbound(chaseId, overrides));
    expect(res.statusCode).toBe(202);
    expect(res.json()).toEqual({ accepted: false, reason, lead_id: leadId });
    expect(background).toHaveLength(0);
  });

  it('ignores mail that is not a Chase Reply', async () => {
    await build();
    const res = await post(inbound('x', { to: 'reply@linkerclaw.ai' }));
    expect(res.json()).toEqual({ accepted: false, reason: 'not_a_chase_reply' });
  });

  it('reports an unknown chase', async () => {
    await build();
    const res = await post(inbound('33333333-3333-4333-8333-333333333333'));
    expect(res.json()).toEqual({ accepted: false, reason: 'unknown_chase' });
  });

  it('treats a redelivered reply as accepted without reviewing twice', async () => {
    const { chaseId } = await chased();
    await post(inbound(chaseId));
    await Promise.all(background);
    const again = await post(inbound(chaseId));
    expect(again.json().accepted).toBe(true);
    await Promise.all(background);
    expect(prequal.reviews).toHaveLength(1);
    expect(notices.delivered.size).toBe(1);
  });

  it('reports a failed step on replay-able failures', async () => {
    const { leadId, chaseId } = await chased();
    notices.failWith = new Error('chase: HTTP 502');
    await post(inbound(chaseId));
    await Promise.all(background);
    const result = (await app.inject({ method: 'GET', url: `/v1/leads/${leadId}` })).json();
    expect(result).toMatchObject({
      status: 'failed',
      failed_step: 'notify',
      error: 'chase: HTTP 502',
    });
  });
});

describe('GET /v1/ops/leads', () => {
  const get = (key = OPS_KEY) =>
    app.inject({
      method: 'GET',
      url: '/v1/ops/leads',
      headers: { authorization: `Bearer ${key}` },
    });

  it('requires the ops key (not another hop key)', async () => {
    await build();
    expect((await get(INBOUND_KEY)).statusCode).toBe(401);
  });

  it('lists failed Leads with their failed step, without the event timeline', async () => {
    prequal.next = new Error('figure-mock: timed out after 5000ms');
    const failed = (await submit()).json();
    prequal.next = approved;
    await app.inject({ method: 'POST', url: '/v1/leads', payload: quiz });

    const res = await get();
    expect(res.statusCode).toBe(200);
    const body = opsLeadsResponseSchema.parse(res.json());
    expect(body.leads).toHaveLength(1);
    expect(body.leads[0]).toMatchObject({
      lead_id: failed.lead_id,
      status: 'failed',
      failed_step: 'prequalify',
      error: 'figure-mock: timed out after 5000ms',
    });
    expect(body.leads[0]).not.toHaveProperty('events');
  });
});

describe('POST /v1/leads: one application per email, repeated submissions (ADR-0007)', () => {
  const post = (payload: object, headers: Record<string, string> = {}) =>
    app.inject({ method: 'POST', url: '/v1/leads', payload, headers });

  it('answers 409 application_in_progress without revealing the open Lead', async () => {
    prequal.next = needDocs;
    const first = await submit();
    expect(first.statusCode).toBe(201);

    const again = await post({ ...quiz, email: 'JOHN@example.com', estimated_home_value: 900_000 });
    expect(again.statusCode).toBe(409);
    expect(again.json()).toMatchObject({ error: SUBMISSION_ERRORS.applicationInProgress });
    expect(again.body).not.toContain(first.json().lead_id);
  });

  it('returns the earlier Lead (200, flagged) for identical answers after a decision', async () => {
    const first = await submit();
    const again = await post(quiz);
    expect(again.statusCode).toBe(200);
    expect(again.headers[HEADERS.idempotentReplayed]).toBe('true');
    expect(again.json().lead_id).toBe(first.json().lead_id);
    expect(notices.calls).toHaveLength(1);
  });

  it('honours Idempotency-Key and refuses it with different answers', async () => {
    const headers = { [HEADERS.idempotencyKey]: '6f1c2c5e-0a4b-4d7e-9c1f-3b2a1d0e9f8a' };
    const first = await submit(quiz, headers);
    const retry = await post(quiz, headers);
    expect(retry.statusCode).toBe(200);
    expect(retry.json().lead_id).toBe(first.json().lead_id);

    const reused = await post({ ...quiz, purpose: 'debt_consolidation' }, headers);
    expect(reused.statusCode).toBe(422);
    expect(reused.json()).toMatchObject({ error: SUBMISSION_ERRORS.idempotencyKeyReused });
  });

  it('rejects a malformed Idempotency-Key', async () => {
    const res = await submit(quiz, { [HEADERS.idempotencyKey]: 'short' });
    expect(res.statusCode).toBe(400);
  });

  it('lets the web origin send Idempotency-Key', async () => {
    await build();
    const res = await app.inject({
      method: 'OPTIONS',
      url: '/v1/leads',
      headers: {
        origin: WEB,
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'content-type,idempotency-key',
      },
    });
    expect(String(res.headers['access-control-allow-headers'])).toContain('idempotency-key');
  });
});
