import { beforeEach, describe, expect, it } from 'vitest';
import { ConcurrencyError } from '../domain/lead-repository.ts';
import type { PrequalDecision } from '../domain/model.ts';
import {
  FakeChases,
  FakePrequal,
  InMemoryLeads,
  sequentialIds,
  silentLogger,
} from '../testing/fakes.ts';
import { createLeadUseCases, LeadNotFoundError } from './lead-use-cases.ts';
import type { AppLogger } from './ports.ts';

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
const rejected: PrequalDecision = { outcome: 'rejected', reason: 'insufficient_home_equity' };
const needDocs: PrequalDecision = {
  outcome: 'need_more_documents',
  missingDocuments: [{ type: 'income_verification', reason: 'Income requires verification' }],
};

const input = {
  borrower: { name: 'John Doe', email: 'john@example.com', phone: '+14155551234' },
  property: { state: 'CA', estimatedValue: 800_000, mortgageBalance: 350_000 },
  creditProfile: { creditBand: '700-739', incomeBand: '150k-200k' },
  purpose: 'home_improvement',
};

let leads: InMemoryLeads;
let prequal: FakePrequal;
let chases: FakeChases;
let useCases: ReturnType<typeof createLeadUseCases>;

function setup(decision: PrequalDecision | Error) {
  leads = new InMemoryLeads();
  prequal = new FakePrequal(decision);
  chases = new FakeChases();
  useCases = createLeadUseCases({
    leads,
    timeline: leads,
    prequal,
    chases,
    clock: { now: () => new Date('2026-09-23T00:00:00Z') },
    ids: sequentialIds(),
  });
}

const submit = async (context = {}) =>
  (await useCases.submitLead(input, context, silentLogger)).lead;
const replay = async (id: string) => (await useCases.replayLead(id, {}, silentLogger)).lead;
const eventTypes = (leadId: string) =>
  leads.events.filter((e) => e.leadId === leadId).map((e) => e.type);

describe('submitLead', () => {
  it.each([
    [approved, 'approved', 'figure.approved'],
    [rejected, 'rejected', 'figure.rejected'],
  ] as const)('%o ends %s without a chase', async (decision, status, event) => {
    setup(decision);
    const lead = await submit();
    expect(lead.status).toBe(status);
    expect(chases.calls).toHaveLength(0);
    expect(eventTypes(lead.id)).toEqual(['lead.created', 'figure.requested', event]);
    expect(leads.rawResponses.get(lead.id)).toEqual({ fake: true, outcome: decision.outcome });
  });

  it('chases a Need More Documents Lead automatically', async () => {
    setup(needDocs);
    const lead = await submit();
    expect(lead.status).toBe('chase_sent');
    expect(chases.calls).toEqual([
      {
        chaseId: 'id-2',
        leadId: 'id-1',
        borrowerName: 'John Doe',
        borrowerEmail: 'john@example.com',
        missingDocuments: needDocs.missingDocuments,
      },
    ]);
    expect(eventTypes(lead.id)).toEqual([
      'lead.created',
      'figure.requested',
      'figure.need_more_documents',
      'chase.created',
      'email.sent',
    ]);
  });

  it('passes the request context (request id, demo scenario) to Prequalification', async () => {
    setup(approved);
    const context = { requestId: 'req-1', scenario: { forcedOutcome: 'approved' as const } };
    await submit(context);
    expect(prequal.calls[0]?.context).toEqual(context);
    expect(prequal.calls[0]?.request).toMatchObject({
      creditBand: '700-739',
      estimatedValue: 800_000,
    });
  });

  it('persists the Lead as failed when Prequalification is unavailable', async () => {
    setup(new Error('figure-mock: timed out after 5000ms'));
    const lead = await submit();
    expect(lead.status).toBe('failed');
    expect(lead.nextStep()).toBe('prequalify');
    expect(leads.events.at(-1)).toMatchObject({
      type: 'lead.failed',
      payload: { step: 'prequalify', reason: 'figure-mock: timed out after 5000ms' },
    });
  });

  it('persists the Lead as failed when the Chase cannot be sent', async () => {
    setup(needDocs);
    chases.failWith = new Error('chase: HTTP 503');
    const lead = await submit();
    expect(lead.status).toBe('failed');
    expect(lead.chase).toMatchObject({ status: 'failed', lastError: 'chase: HTTP 503' });
    expect(eventTypes(lead.id).slice(-2)).toEqual(['email.failed', 'lead.failed']);
  });

  it('logs every committed event with the lead id', async () => {
    setup(approved);
    const logged: object[] = [];
    const log: AppLogger = { ...silentLogger, info: (obj) => logged.push(obj) };
    const { lead } = await useCases.submitLead(input, {}, log);
    expect(logged).toEqual([
      { lead_id: lead.id, event: 'lead.created' },
      { lead_id: lead.id, event: 'figure.requested' },
      { lead_id: lead.id, event: 'figure.approved', amount: 150_000, apr_min: 7.5 },
    ]);
  });
});

describe('replayLead', () => {
  beforeEach(() => setup(needDocs));

  it('resumes a Lead that failed at Prequalification', async () => {
    prequal.next = new Error('down');
    const failed = await submit();
    prequal.next = approved;

    const lead = await replay(failed.id);
    expect(lead.status).toBe('approved');
    expect(prequal.calls).toHaveLength(2);
    expect(eventTypes(lead.id)).toContain('lead.replayed');
  });

  it('resends a failed Chase with the same chase id, so only one email goes out', async () => {
    chases.failWith = new Error('email service unavailable');
    const failed = await submit();
    chases.failWith = undefined;

    const lead = await replay(failed.id);
    expect(lead.status).toBe('chase_sent');
    expect(chases.calls.map((c) => c.chaseId)).toEqual(['id-2', 'id-2']);
    expect(chases.delivered.size).toBe(1);
    expect(prequal.calls).toHaveLength(1); // the decision is never re-pulled
  });

  it('does nothing but record the replay for a completed Lead', async () => {
    const done = await submit();
    const lead = await replay(done.id);
    expect(lead.status).toBe('chase_sent');
    expect(prequal.calls).toHaveLength(1);
    expect(chases.calls).toHaveLength(1);
    expect(eventTypes(lead.id).at(-1)).toBe('lead.replayed');
  });

  it('rejects an unknown Lead', async () => {
    await expect(useCases.replayLead('missing', {}, silentLogger)).rejects.toBeInstanceOf(
      LeadNotFoundError,
    );
  });
});

describe('getLead', () => {
  it('returns the Lead with its event timeline', async () => {
    setup(approved);
    const { id } = await submit();
    const view = await useCases.getLead(id);
    expect(view.lead.status).toBe('approved');
    expect(view.events.map((e) => e.type)).toEqual([
      'lead.created',
      'figure.requested',
      'figure.approved',
    ]);
  });
});

describe('concurrency', () => {
  it('refuses to save a stale copy of a Lead', async () => {
    setup(new Error('down'));
    const { id } = await submit();
    const first = (await leads.findById(id))!;
    const second = (await leads.findById(id))!;
    first.replay(new Date());
    await leads.save(first);
    second.replay(new Date());
    await expect(leads.save(second)).rejects.toBeInstanceOf(ConcurrencyError);
  });
});
