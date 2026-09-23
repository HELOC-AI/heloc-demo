import { Writable } from 'node:stream';
import { PGlite } from '@electric-sql/pglite';
import { intakeEnv, loadConfig } from '@heloc/config';
import { leadResultSchema } from '@heloc/contracts';
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
import { FakeChases, FakePrequal } from './testing/fakes.ts';

const silent = new Writable({ write: (_c, _e, cb) => cb() });
const key = 'k'.repeat(64);
const WEB = 'https://heloc-demo.vercel.app';

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
    }),
    logger: createLogger({ service: 'test', destination: silent }).logger,
    version: 'test',
    store: new DrizzleLeadRepository(db),
    pingDatabase: async () => {
      if (pingFails) throw new Error('db down');
    },
    prequal,
    chases,
  });
  return app;
}

beforeEach(() => {
  prequal = new FakePrequal(approved);
  chases = new FakeChases();
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
    });
    expect(body.events?.map((e) => e.type)).toEqual([
      'lead.created',
      'figure.requested',
      'figure.approved',
    ]);
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
