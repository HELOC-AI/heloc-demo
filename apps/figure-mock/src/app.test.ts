import { Writable } from 'node:stream';
import { softPullResponseSchema } from '@heloc/contracts';
import { figureMockEnv, loadConfig } from '@heloc/config';
import { createLogger } from '@heloc/logger';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from './app.ts';

const silent = new Writable({ write: (_c, _e, cb) => cb() });
const KEY = 'k'.repeat(64);
const auth = { authorization: `Bearer ${KEY}` };
const body = {
  lead_id: '00000000-0000-4000-8000-000000000001',
  property_state: 'CA',
  estimated_home_value: 800_000,
  mortgage_balance: 350_000,
  credit_band: '700-739',
  income_band: '150k-200k',
};

let app: ReturnType<typeof buildApp>;
function build() {
  app = buildApp({
    config: loadConfig(figureMockEnv, { INTERNAL_API_KEY: KEY }),
    logger: createLogger({ service: 'test', destination: silent }).logger,
    version: 'test',
    clock: { now: () => new Date('2026-09-23T00:00:00Z') },
    faultDelayMs: 50,
  });
  return app;
}
afterEach(() => app?.close());

const softPull = (payload: object, headers: Record<string, string> = {}) =>
  build().inject({
    method: 'POST',
    url: '/v1/soft-pull',
    headers: { ...auth, ...headers },
    payload,
  });

describe('GET /health', () => {
  it('is public', async () => {
    const res = await build().inject({ method: 'GET', url: '/health' });
    expect(res.json()).toMatchObject({ status: 'ok', service: 'figure-mock' });
  });
});

describe('POST /v1/soft-pull', () => {
  it('requires the internal key', async () => {
    const res = await build().inject({ method: 'POST', url: '/v1/soft-pull', payload: body });
    expect(res.statusCode).toBe(401);
  });

  it.each([
    ['780+', 'approved'],
    ['700-739', 'need-more-documents'],
    ['<580', 'rejected'],
  ])('credit %s → %s, in the contract shape', async (credit_band, status) => {
    const res = await softPull({ ...body, credit_band });
    expect(res.statusCode).toBe(200);
    const parsed = softPullResponseSchema.parse(res.json());
    expect(parsed.status).toBe(status);
  });

  it('returns the offer fields the spec requires', async () => {
    const res = await softPull({ ...body, credit_band: '780+' });
    expect(res.json().offer).toEqual({
      lender: 'Figure mock',
      amount: 250_000,
      apr_min: 7.5,
      apr_max: 9.5,
      term_months: 120,
      estimated_monthly_payment: 2968,
      expires_at: '2026-10-23T00:00:00.000Z',
    });
  });

  it('honours X-Mock-Outcome', async () => {
    const res = await softPull({ ...body, credit_band: '780+' }, { 'x-mock-outcome': 'rejected' });
    expect(res.json()).toEqual({ status: 'rejected', reason: 'insufficient_home_equity' });
  });

  it('rejects an unknown X-Mock-Outcome', async () => {
    const res = await softPull(body, { 'x-mock-outcome': 'maybe' });
    expect(res.statusCode).toBe(400);
  });

  it('injects a server error', async () => {
    const res = await softPull(body, { 'x-mock-fault': 'error' });
    expect(res.statusCode).toBe(503);
    expect(res.json().error).toBe('injected_fault');
  });

  it('injects a delay for the timeout fault, then answers', async () => {
    const started = Date.now();
    const res = await softPull(body, { 'x-mock-fault': 'timeout' });
    expect(Date.now() - started).toBeGreaterThanOrEqual(45);
    expect(res.statusCode).toBe(200);
  });

  it('validates the request', async () => {
    const res = await softPull({ ...body, credit_band: 'excellent' });
    expect(res.statusCode).toBe(400);
    expect(res.json().details[0].path).toBe('credit_band');
  });
});
