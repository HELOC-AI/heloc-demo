import { describe, expect, it } from 'vitest';
import { Lead, type SubmitLeadInput } from './lead.ts';
import {
  DomainError,
  type IncomingReply,
  type PrequalDecision,
  type ReviewDecision,
} from './model.ts';

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
  replyTo: 'reply+c1@linkerclaw.ai',
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
    [approved, 'approved', 'figure.approved', 'notify'],
    [rejected, 'rejected', 'figure.rejected', 'notify'],
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
    lead.openNotice('n1', t0);
    lead.markNoticeSent(
      { subject: 'An update', body: 'Hi John…', emailMessageId: 'email_n1', sentAt: t0 },
      t0,
    );
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

describe('chase reply → document review → outcome notice', () => {
  const reply = (overrides: Partial<IncomingReply> = {}): IncomingReply => ({
    messageId: '<m1@mail.example.com>',
    receivedAt: t0,
    from: 'John@Example.com',
    dmarc: 'pass',
    attachments: [
      {
        filename: 'paystub.pdf',
        contentType: 'application/pdf',
        size: 1234,
        sha256: 'a'.repeat(64),
      },
    ],
    ...overrides,
  });
  const reviewApproved: ReviewDecision = { outcome: 'approved', offer: approved.offer };
  const noticeDelivery = {
    subject: 'Your HELOC offer is ready',
    body: 'Hi John',
    emailMessageId: 'email_9',
    sentAt: t0,
  };

  function chased() {
    const lead = decided(needDocs);
    lead.openChase('c1', t0);
    lead.markChaseSent(delivery, t0);
    return lead;
  }

  it('waits for the borrower once the Chase is sent', () => {
    expect(chased().nextStep()).toBe('done');
  });

  it('accepts an authenticated reply from the borrower with documents', () => {
    const lead = chased();
    expect(lead.receiveReply(reply(), t0)).toEqual({ accepted: true, duplicate: false });
    expect(lead.status).toBe('documents_received');
    expect(lead.chase?.reply?.attachments).toHaveLength(1);
    expect(lead.nextStep()).toBe('review');
    expect(lead.pendingEvents().at(-1)).toMatchObject({
      type: 'documents.received',
      payload: { chase_id: 'c1', attachments: 1, content_types: ['application/pdf'] },
    });
  });

  it.each([
    [{ dmarc: 'fail' as const }, 'not_authenticated'],
    [{ dmarc: 'unknown' as const }, 'not_authenticated'],
    [{ from: 'attacker@example.com' }, 'sender_mismatch'],
    [{ attachments: [] }, 'no_attachments'],
  ])('refuses %o (%s) without changing state', (overrides, reason) => {
    const lead = chased();
    expect(lead.receiveReply(reply(overrides), t0)).toEqual({ accepted: false, reason });
    expect(lead.status).toBe('chase_sent');
    expect(lead.nextStep()).toBe('done');
    const event = lead.pendingEvents().at(-1);
    expect(event).toMatchObject({ type: 'documents.rejected', payload: { reason } });
    expect(JSON.stringify(event)).not.toContain('attacker@example.com');
  });

  it('refuses a reply before the Chase was sent', () => {
    expect(decided(needDocs).receiveReply(reply(), t0)).toEqual({
      accepted: false,
      reason: 'chase_not_sent',
    });
  });

  it('treats a redelivery of the accepted email as a no-op, and refuses a second reply', () => {
    const lead = chased();
    lead.receiveReply(reply(), t0);
    const events = lead.pendingEvents().length;
    expect(lead.receiveReply(reply(), t0)).toEqual({ accepted: true, duplicate: true });
    expect(lead.pendingEvents()).toHaveLength(events);
    expect(lead.receiveReply(reply({ messageId: '<m2@x>' }), t0)).toEqual({
      accepted: false,
      reason: 'already_received',
    });
  });

  it('runs one Document Review, then one Outcome Notice', () => {
    const lead = chased();
    lead.receiveReply(reply(), t0);
    lead.startReview(t0);
    lead.recordReview(reviewApproved, t0);
    expect(lead.status).toBe('approved');
    expect(lead.nextStep()).toBe('notify');
    expectDomainError(() => lead.recordReview(reviewApproved, t0), 'review_not_due');

    lead.openNotice('n1', t0);
    lead.markNoticeSent(noticeDelivery, t0);
    expect(lead.status).toBe('approved');
    expect(lead.nextStep()).toBe('done');
    expect(types(lead).slice(-6)).toEqual([
      'email.sent',
      'documents.received',
      'figure.review_requested',
      'figure.review_approved',
      'notice.created',
      'notice.sent',
    ]);
  });

  it('a rejected review is notified too', () => {
    const lead = chased();
    lead.receiveReply(reply(), t0);
    lead.startReview(t0);
    lead.recordReview({ outcome: 'rejected', reason: 'credit_below_minimum' }, t0);
    expect(lead.status).toBe('rejected');
    expect(lead.nextStep()).toBe('notify');
  });

  it('review cannot start without documents', () => {
    expectDomainError(() => chased().startReview(t0), 'review_not_due');
  });

  it('a failed review resumes at review; a failed notice resumes at notify and restores the outcome', () => {
    const lead = chased();
    lead.receiveReply(reply(), t0);
    lead.startReview(t0);
    lead.fail('review', 'figure down', t0);
    expect(lead.status).toBe('failed');
    expect(lead.nextStep()).toBe('review');

    lead.startReview(t0);
    expect(lead.status).toBe('documents_received');
    lead.recordReview(reviewApproved, t0);
    lead.openNotice('n1', t0);
    lead.markNoticeFailed('email down', t0);
    expect(lead.status).toBe('failed');
    expect(lead.nextStep()).toBe('notify');
    expect(lead.notice).toMatchObject({ status: 'failed', lastError: 'email down' });

    lead.markNoticeSent(noticeDelivery, t0);
    expect(lead.status).toBe('approved');
    expect(lead.notice?.lastError).toBeUndefined();
  });

  it('no notice while documents are still awaited', () => {
    const lead = decided(needDocs);
    expectDomainError(() => lead.openNotice('n1', t0), 'notice_not_due');
    lead.openChase('c1', t0);
    lead.markChaseSent(delivery, t0);
    expectDomainError(() => lead.openNotice('n1', t0), 'notice_not_due');
  });
});

describe('outcome notice after the soft pull', () => {
  const noticeDelivery = {
    subject: 'Your HELOC offer is ready',
    body: 'Hi John…',
    emailMessageId: 'email_n1',
    sentAt: t0,
  };

  it.each([
    [approved, 'approved'],
    [rejected, 'rejected'],
  ] as const)('tells the borrower about %o, once', (decision, status) => {
    const lead = decided(decision);
    expect(lead.nextStep()).toBe('notify');
    lead.openNotice('n1', t0);
    expectDomainError(() => lead.openNotice('n2', t0), 'notice_exists');
    lead.markNoticeSent(noticeDelivery, t0);
    expect(lead.status).toBe(status);
    expect(lead.nextStep()).toBe('done');
    expect(types(lead).slice(-2)).toEqual(['notice.created', 'notice.sent']);
    expectDomainError(() => lead.markNoticeSent(noticeDelivery, t0), 'notice_sent');
  });

  it('a failed notice fails the Lead, resumes at notify and restores the decision', () => {
    const lead = decided(approved);
    lead.openNotice('n1', t0);
    lead.markNoticeFailed('email down', t0);
    expect(lead.status).toBe('failed');
    expect(lead.decision).toEqual(approved);
    expect(lead.nextStep()).toBe('notify');

    lead.markNoticeSent(noticeDelivery, t0);
    expect(lead.status).toBe('approved');
    expect(lead.notice).toMatchObject({ status: 'sent', emailMessageId: 'email_n1' });
  });

  it('keeps PII out of the notice events', () => {
    const lead = decided(approved);
    lead.openNotice('n1', t0);
    lead.markNoticeSent(noticeDelivery, t0);
    const payloads = JSON.stringify(lead.pendingEvents());
    expect(payloads).not.toContain('john@example.com');
    expect(payloads).not.toContain('John Doe');
  });
});

describe('open Leads and repeated submissions (ADR-0007)', () => {
  it('a Lead is Open until it settles as Approved or Rejected', () => {
    const lead = Lead.submit(input(), t0);
    expect(lead.isOpen).toBe(true);
    lead.startPrequalification(t0);
    lead.fail('prequalify', 'figure down', t0);
    expect(lead.isOpen).toBe(true);
    expect(decided(needDocs).isOpen).toBe(true);
    expect(decided(approved).isOpen).toBe(false);
    expect(decided(rejected).isOpen).toBe(false);
  });

  it('matches a submission with the same answers, ignoring email case and name padding', () => {
    const lead = Lead.submit(input(), t0);
    const { id: _, ...answers } = input();
    expect(lead.matchesSubmission(answers)).toBe(true);
    expect(
      lead.matchesSubmission({
        ...answers,
        borrower: { ...answers.borrower, name: ' John Doe ', email: 'JOHN@example.com' },
      }),
    ).toBe(true);
  });

  it.each([
    ['name', { borrower: { name: 'Jane Doe', email: 'john@example.com', phone: '+14155551234' } }],
    ['phone', { borrower: { name: 'John Doe', email: 'john@example.com', phone: '+14155550000' } }],
    [
      'home value',
      { property: { state: 'CA', estimatedValue: 900_000, mortgageBalance: 350_000 } },
    ],
    ['state', { property: { state: 'NY', estimatedValue: 800_000, mortgageBalance: 350_000 } }],
    ['credit band', { creditProfile: { creditBand: '780+', incomeBand: '150k-200k' } }],
    ['purpose', { purpose: 'debt_consolidation' }],
  ])('does not match when the %s changed', (_, overrides) => {
    const { id: _id, ...answers } = input(overrides as Partial<SubmitLeadInput>);
    expect(Lead.submit(input(), t0).matchesSubmission(answers)).toBe(false);
  });
});
