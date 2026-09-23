import { describe, expect, it } from 'vitest';
import { Lead, type SubmitLeadInput } from './lead.ts';
import { DomainError, type PrequalDecision } from './model.ts';

const t0 = new Date('2026-09-23T00:00:00Z');
const input = (overrides: Partial<SubmitLeadInput> = {}): SubmitLeadInput => ({
  id: 'lead-1',
  borrower: { name: 'John Doe', email: 'john@example.com', phone: '+14155551234' },
  property: { state: 'CA', estimatedValue: 800_000, mortgageBalance: 350_000 },
  creditProfile: { creditBand: '700-739', incomeBand: '150k-200k' },
  purpose: 'home_improvement',
  ...overrides,
});

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
const delivery = {
  subject: 'Additional documents required for your HELOC application',
  body: 'Hi John…',
  emailMessageId: 'email_123',
  sentAt: t0,
};

const types = (lead: Lead) => lead.pendingEvents().map((e) => e.type);
const expectDomainError = (fn: () => void, code: string) => {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(DomainError);
    expect((err as DomainError).code).toBe(code);
    return;
  }
  throw new Error(`expected DomainError ${code}`);
};

function decided(decision: PrequalDecision) {
  const lead = Lead.submit(input(), t0);
  lead.startPrequalification(t0);
  lead.recordDecision(decision, t0);
  return lead;
}

describe('Lead.submit', () => {
  it('starts submitted with a lead.created event and needs prequalification', () => {
    const lead = Lead.submit(input(), t0);
    expect(lead.status).toBe('submitted');
    expect(lead.nextStep()).toBe('prequalify');
    expect(types(lead)).toEqual(['lead.created']);
    expect(lead.version).toBe(0);
  });

  it.each([
    [{ borrower: { name: ' ', email: 'a@b.co', phone: '+1' } }, 'name'],
    [{ borrower: { name: 'A', email: 'nope', phone: '+1' } }, 'email'],
    [{ property: { state: 'CA', estimatedValue: 0, mortgageBalance: 0 } }, 'estimated_home_value'],
    [{ property: { state: 'CA', estimatedValue: 1, mortgageBalance: -1 } }, 'mortgage_balance'],
  ])('refuses invalid data (%o)', (overrides, field) => {
    expect(() => Lead.submit(input(overrides), t0)).toThrow(new RegExp(field));
  });

  it('allows a paid-off home', () => {
    const property = { state: 'CA', estimatedValue: 500_000, mortgageBalance: 0 };
    expect(Lead.submit(input({ property }), t0).status).toBe('submitted');
  });
});

describe('prequalification', () => {
  it.each([
    [approved, 'approved', 'figure.approved', 'done'],
    [rejected, 'rejected', 'figure.rejected', 'done'],
    [needDocs, 'need_more_documents', 'figure.need_more_documents', 'chase'],
  ] as const)('records %o', (decision, status, event, next) => {
    const lead = decided(decision);
    expect(lead.status).toBe(status);
    expect(lead.nextStep()).toBe(next);
    expect(types(lead)).toEqual(['lead.created', 'figure.requested', event]);
  });

  it('keeps PII out of event payloads', () => {
    const payloads = JSON.stringify(decided(needDocs).pendingEvents());
    expect(payloads).not.toContain('john@example.com');
    expect(payloads).not.toContain('John Doe');
  });

  it('never replaces a decision', () => {
    const lead = decided(approved);
    expectDomainError(() => lead.startPrequalification(t0), 'decision_exists');
    expectDomainError(() => lead.recordDecision(rejected, t0), 'decision_exists');
  });

  it('requires prequalification to have started', () => {
    expectDomainError(
      () => Lead.submit(input(), t0).recordDecision(approved, t0),
      'not_processing',
    );
  });
});

describe('chase', () => {
  it('is opened only for a Need More Documents Lead, and only once', () => {
    expectDomainError(() => decided(approved).openChase('c1', t0), 'chase_not_needed');
    const lead = decided(needDocs);
    lead.openChase('c1', t0);
    expect(lead.chase).toEqual({ id: 'c1', status: 'pending' });
    expectDomainError(() => lead.openChase('c2', t0), 'chase_exists');
  });

  it('moves the Lead to chase_sent when sent', () => {
    const lead = decided(needDocs);
    lead.openChase('c1', t0);
    lead.markChaseSent(delivery, t0);
    expect(lead.status).toBe('chase_sent');
    expect(lead.chase).toMatchObject({ status: 'sent', emailMessageId: 'email_123' });
    expect(lead.nextStep()).toBe('done');
    expect(types(lead).slice(-2)).toEqual(['chase.created', 'email.sent']);
  });

  it('fails the Lead when sending fails, and can still be sent later', () => {
    const lead = decided(needDocs);
    lead.openChase('c1', t0);
    lead.markChaseFailed('email service unavailable', t0);
    expect(lead.status).toBe('failed');
    expect(lead.chase).toMatchObject({ status: 'failed', lastError: 'email service unavailable' });
    expect(lead.nextStep()).toBe('chase');
    expect(types(lead).slice(-2)).toEqual(['email.failed', 'lead.failed']);

    lead.markChaseSent(delivery, t0);
    expect(lead.status).toBe('chase_sent');
    expect(lead.chase?.lastError).toBeUndefined();
  });

  it('cannot be sent twice', () => {
    const lead = decided(needDocs);
    lead.openChase('c1', t0);
    lead.markChaseSent(delivery, t0);
    expectDomainError(() => lead.markChaseSent(delivery, t0), 'chase_sent');
    expectDomainError(() => lead.markChaseFailed('x', t0), 'chase_sent');
  });
});

describe('failure and replay', () => {
  it('a Lead failed during prequalification resumes at prequalification', () => {
    const lead = Lead.submit(input(), t0);
    lead.startPrequalification(t0);
    lead.fail('prequalify', 'figure timeout', t0);
    expect(lead.status).toBe('failed');
    expect(lead.nextStep()).toBe('prequalify');

    lead.replay(t0);
    lead.startPrequalification(t0);
    lead.recordDecision(approved, t0);
    expect(lead.status).toBe('approved');
    expect(types(lead)).toEqual([
      'lead.created',
      'figure.requested',
      'lead.failed',
      'lead.replayed',
      'figure.requested',
      'figure.approved',
    ]);
  });

  it('a Lead stuck in processing (crash mid-call) can be prequalified again', () => {
    const lead = Lead.submit(input(), t0);
    lead.startPrequalification(t0);
    lead.startPrequalification(t0);
    expect(lead.status).toBe('processing');
  });

  it('a completed Lead cannot fail, and replaying it changes nothing', () => {
    const lead = decided(rejected);
    expectDomainError(() => lead.fail('prequalify', 'x', t0), 'already_complete');
    lead.replay(t0);
    expect(lead.status).toBe('rejected');
    expect(lead.nextStep()).toBe('done');
    expect(lead.pendingEvents().at(-1)).toMatchObject({
      type: 'lead.replayed',
      payload: { from_status: 'rejected', next_step: 'done' },
    });
  });
});

describe('persistence support', () => {
  it('round-trips through a snapshot without sharing state', () => {
    const lead = decided(needDocs);
    const copy = Lead.rehydrate(lead.snapshot());
    expect(copy.snapshot()).toEqual(lead.snapshot());
    expect(copy.pendingEvents()).toEqual([]);
    copy.openChase('c1', t0);
    expect(lead.chase).toBeUndefined();
  });

  it('bumps the version and clears events once persisted', () => {
    const lead = decided(approved);
    lead.markPersisted();
    expect(lead.version).toBe(1);
    expect(lead.pendingEvents()).toEqual([]);
  });
});
