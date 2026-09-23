import type { LeadInput, LeadResult } from '@heloc/contracts';
import { describe, expect, it, vi } from 'vitest';
import { createLeadApi } from './api.ts';

const LEAD_ID = '6f1c2a4e-8b3d-4c5e-9f7a-1b2c3d4e5f60';
const BASE = 'https://intake.test';

const input: LeadInput = {
  name: 'Jane Doe',
  email: 'jane@example.com',
  phone: '+14155551234',
  property_state: 'CA',
  estimated_home_value: 800_000,
  mortgage_balance: 350_000,
  credit_band: '700-739',
  income_band: '150k-200k',
  purpose: 'home_improvement',
};

const approved: LeadResult = {
  lead_id: LEAD_ID,
  status: 'approved',
  offer: {
    lender: 'Figure mock',
    amount: 250_000,
    apr_min: 7.5,
    apr_max: 9.5,
    term_months: 120,
    estimated_monthly_payment: 2968,
    expires_at: '2026-10-23T10:00:00.000Z',
  },
  events: [],
};

function stubFetch(status: number, body?: unknown) {
  return vi.fn<typeof fetch>(
    async () =>
      new Response(body === undefined ? null : JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
  );
}

function headersOf(fetchMock: ReturnType<typeof stubFetch>) {
  const init = fetchMock.mock.calls[0]?.[1];
  return new Headers(init?.headers);
}

describe('submitLead', () => {
  it('posts the Lead as JSON and returns the LeadResult', async () => {
    const fetchMock = stubFetch(201, approved);
    const result = await createLeadApi(BASE, fetchMock).submitLead(input);

    expect(result).toEqual({ kind: 'lead', lead: approved });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(`${BASE}/v1/leads`);
    expect(init?.method).toBe('POST');
    expect(JSON.parse(String(init?.body))).toEqual(input);
    expect(headersOf(fetchMock).get('content-type')).toBe('application/json');
    expect(headersOf(fetchMock).has('x-mock-outcome')).toBe(false);
  });

  it('sends the idempotency key when given', async () => {
    const fetchMock = stubFetch(201, approved);
    await createLeadApi(BASE, fetchMock).submitLead(input);
    expect(headersOf(fetchMock).has('idempotency-key')).toBe(false);
    await createLeadApi(BASE, fetchMock).submitLead(input, { idempotencyKey: 'key-00000001' });
    expect(new Headers(fetchMock.mock.calls[1]?.[1]?.headers).get('idempotency-key')).toBe(
      'key-00000001',
    );
  });

  it('reports an application already in progress for the email', async () => {
    const body = { error: 'application_in_progress', message: 'in progress' };
    const result = await createLeadApi(BASE, stubFetch(409, body)).submitLead(input);
    expect(result).toEqual({ kind: 'in_progress' });
  });

  it('forwards the demo outcome header', async () => {
    const fetchMock = stubFetch(201, approved);
    await createLeadApi(BASE, fetchMock).submitLead(input, { mockOutcome: 'rejected' });
    expect(headersOf(fetchMock).get('x-mock-outcome')).toBe('rejected');
  });

  it('treats a 502 with a failed Lead as a Lead (it was persisted and can be replayed)', async () => {
    const failed: LeadResult = { lead_id: LEAD_ID, status: 'failed', error: 'figure timeout' };
    const result = await createLeadApi(BASE, stubFetch(502, failed)).submitLead(input);
    expect(result).toEqual({ kind: 'lead', lead: failed });
  });

  it('maps a 400 onto field errors', async () => {
    const body = {
      error: 'invalid_request',
      message: 'Request validation failed',
      details: [{ path: 'email', message: 'Enter a valid email' }],
    };
    const result = await createLeadApi(BASE, stubFetch(400, body)).submitLead(input);
    expect(result).toEqual({
      kind: 'invalid',
      errors: { email: 'Enter a valid email' },
      messages: [],
    });
  });

  it('reports a network failure', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => {
      throw new TypeError('Failed to fetch');
    });
    const result = await createLeadApi(BASE, fetchMock).submitLead(input);
    expect(result).toMatchObject({ kind: 'error', message: expect.stringContaining('reach') });
  });

  it('rejects a response that does not match the contract', async () => {
    const result = await createLeadApi(BASE, stubFetch(201, { hello: 'world' })).submitLead(input);
    expect(result.kind).toBe('error');
  });
});

describe('getLead', () => {
  it('fetches the Lead without a content-type', async () => {
    const fetchMock = stubFetch(200, approved);
    const result = await createLeadApi(BASE, fetchMock).getLead(LEAD_ID);
    expect(result).toEqual({ kind: 'lead', lead: approved });
    expect(fetchMock.mock.calls[0]?.[0]).toBe(`${BASE}/v1/leads/${LEAD_ID}`);
    expect(fetchMock.mock.calls[0]?.[1]?.method).toBe('GET');
    expect(headersOf(fetchMock).has('content-type')).toBe(false);
  });

  it('reports a missing Lead', async () => {
    const result = await createLeadApi(BASE, stubFetch(404, { error: 'lead_not_found' })).getLead(
      LEAD_ID,
    );
    expect(result).toEqual({ kind: 'not_found' });
  });

  it('does not ask intake about ids that cannot exist', async () => {
    const fetchMock = stubFetch(200, approved);
    expect(await createLeadApi(BASE, fetchMock).getLead('not-a-uuid')).toEqual({
      kind: 'not_found',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('replayLead', () => {
  it('posts without a body or content-type', async () => {
    const fetchMock = stubFetch(200, approved);
    const result = await createLeadApi(BASE, fetchMock).replayLead(LEAD_ID);
    expect(result).toEqual({ kind: 'lead', lead: approved });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(`${BASE}/v1/leads/${LEAD_ID}/replay`);
    expect(init?.method).toBe('POST');
    expect(init?.body).toBeUndefined();
    expect(headersOf(fetchMock).has('content-type')).toBe(false);
  });

  it('reports a concurrent replay', async () => {
    const result = await createLeadApi(BASE, stubFetch(409, { error: 'conflict' })).replayLead(
      LEAD_ID,
    );
    expect(result).toEqual({ kind: 'conflict' });
  });
});
