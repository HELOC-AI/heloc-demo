import { beforeEach, describe, expect, it } from 'vitest';
import { ConcurrencyError, OpenLeadExistsError } from '../domain/lead-repository.ts';
import type { IncomingReply, PrequalDecision } from '../domain/model.ts';
import {
  FakeChases,
  FakeNotices,
  FakePrequal,
  InMemoryLeads,
  sequentialIds,
  silentLogger,
} from '../testing/fakes.ts';
import {
  createLeadUseCases,
  IdempotencyKeyReusedError,
  LeadNotFoundError,
} from './lead-use-cases.ts';
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
let notices: FakeNotices;
let useCases: ReturnType<typeof createLeadUseCases>;

function setup(decision: PrequalDecision | Error) {
  leads = new InMemoryLeads();
  prequal = new FakePrequal(decision);
  chases = new FakeChases();
  notices = new FakeNotices();
  useCases = createLeadUseCases({
    leads,
    timeline: leads,
    prequal,
    chases,
    notices,
    clock: { now: () => new Date('2026-09-23T00:00:00Z') },
    ids: sequentialIds(),
    resultUrl: (id) => `https://heloc-demo.vercel.app/result/${id}`,
  });
}

const submit = async (context = {}, email = input.borrower.email) =>
  (
    await useCases.submitLead(
      { ...input, borrower: { ...input.borrower, email } },
      context,
      silentLogger,
    )
  ).lead;
const replay = async (id: string) => (await useCases.replayLead(id, {}, silentLogger)).lead;
const eventTypes = (leadId: string) =>
  leads.events.filter((e) => e.leadId === leadId).map((e) => e.type);

describe('submitLead', () => {
  it.each([
    [approved, 'approved', 'figure.approved'],
    [rejected, 'rejected', 'figure.rejected'],
  ] as const)(
    '%o ends %s and emails the outcome, without a chase',
    async (decision, status, event) => {
      setup(decision);
      const lead = await submit();
      expect(lead.status).toBe(status);
      expect(chases.calls).toHaveLength(0);
      expect(notices.calls).toEqual([
        {
          noticeId: 'id-2',
          leadId: 'id-1',
          borrowerName: 'John Doe',
          borrowerEmail: 'john@example.com',
          outcome: decision,
          basis: 'prequalification',
          resultUrl: 'https://heloc-demo.vercel.app/result/id-1',
        },
      ]);
      expect(lead.notice).toMatchObject({ status: 'sent', emailMessageId: 'notice_email_1' });
      expect(eventTypes(lead.id)).toEqual([
        'lead.created',
        'figure.requested',
        event,
        'notice.created',
        'notice.sent',
      ]);
      expect(leads.rawResponses.get(lead.id)).toEqual({ fake: true, outcome: decision.outcome });
    },
  );

  it('keeps the decision when its email fails; Replay sends it exactly once', async () => {
    setup(approved);
    notices.failWith = new Error('chase: HTTP 502');
    const failed = await submit();
    expect(failed.status).toBe('failed');
    expect(failed.decision).toEqual(approved);
    expect(failed.nextStep()).toBe('notify');
    expect(eventTypes(failed.id).slice(-2)).toEqual(['notice.failed', 'lead.failed']);

    notices.failWith = undefined;
    const lead = await replay(failed.id);
    expect(lead.status).toBe('approved');
    expect(prequal.calls).toHaveLength(1);
    expect(new Set(notices.calls.map((c) => c.noticeId))).toEqual(new Set(['id-2']));
    expect(notices.delivered.size).toBe(1);
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

  it('logs failures at error level', async () => {
    setup(new Error('down'));
    const errors: object[] = [];
    const log: AppLogger = { ...silentLogger, error: (obj) => errors.push(obj) };
    const { lead } = await useCases.submitLead(input, {}, log);
    expect(errors).toEqual([
      { lead_id: lead.id, event: 'lead.failed', step: 'prequalify', reason: 'down' },
    ]);
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
      { lead_id: lead.id, event: 'notice.created', notice_id: 'id-2' },
      {
        lead_id: lead.id,
        event: 'notice.sent',
        notice_id: 'id-2',
        email_message_id: 'notice_email_1',
      },
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
      'notice.created',
      'notice.sent',
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

describe('chase reply → document review → outcome notice', () => {
  const reply = (overrides: Partial<IncomingReply> = {}): IncomingReply => ({
    messageId: '<reply-1@mail.example.com>',
    receivedAt: new Date('2026-09-23T01:00:00Z'),
    from: 'john@example.com',
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

  async function chasedLead() {
    setup(needDocs);
    const lead = await submit();
    return { lead, chaseId: lead.chase!.id };
  }

  const receive = (chaseId: string, overrides: Partial<IncomingReply> = {}) =>
    useCases.receiveChaseReply(chaseId, reply(overrides), silentLogger);
  const resume = async (id: string) => (await useCases.continueLead(id, {}, silentLogger)).lead;

  it('accepts the reply, reviews the documents and notifies the borrower', async () => {
    const { lead, chaseId } = await chasedLead();
    expect(lead.status).toBe('chase_sent');
    expect(lead.nextStep()).toBe('done');

    expect(await receive(chaseId)).toEqual({
      outcome: { accepted: true, duplicate: false },
      leadId: lead.id,
    });
    const done = await resume(lead.id);
    expect(done.status).toBe('approved');
    expect(prequal.reviews).toEqual([
      expect.objectContaining({
        documents: needDocs.missingDocuments,
        attachments: [{ filename: 'paystub.pdf', contentType: 'application/pdf', size: 1234 }],
      }),
    ]);
    expect(notices.calls).toEqual([
      expect.objectContaining({
        borrowerEmail: 'john@example.com',
        outcome: prequal.nextReview,
        basis: 'document_review',
        resultUrl: `https://heloc-demo.vercel.app/result/${lead.id}`,
      }),
    ]);
    expect(eventTypes(lead.id).slice(-5)).toEqual([
      'documents.received',
      'figure.review_requested',
      'figure.review_approved',
      'notice.created',
      'notice.sent',
    ]);
  });

  it('refuses a reply from someone else without touching the Lead', async () => {
    const { lead, chaseId } = await chasedLead();
    const result = await receive(chaseId, { from: 'attacker@example.com' });
    expect(result.outcome).toEqual({ accepted: false, reason: 'sender_mismatch' });
    expect((await resume(lead.id)).status).toBe('chase_sent');
    expect(prequal.reviews).toHaveLength(0);
  });

  it('reports an unknown chase', async () => {
    setup(needDocs);
    expect(await receive('33333333-3333-4333-8333-333333333333')).toEqual({
      outcome: { accepted: false, reason: 'unknown_chase' },
    });
  });

  it('replays a failed review, then a failed notice, without duplicating either', async () => {
    const { lead, chaseId } = await chasedLead();
    await receive(chaseId);

    prequal.nextReview = new Error('figure-mock: HTTP 503');
    expect((await resume(lead.id)).status).toBe('failed');
    expect((await leads.findById(lead.id))!.nextStep()).toBe('review');

    prequal.nextReview = { outcome: 'rejected', reason: 'credit_below_minimum' };
    notices.failWith = new Error('chase: HTTP 502');
    const afterReview = await replay(lead.id);
    expect(afterReview.status).toBe('failed');
    expect(afterReview.nextStep()).toBe('notify');

    notices.failWith = undefined;
    const done = await replay(lead.id);
    expect(done.status).toBe('rejected');
    expect(done.nextStep()).toBe('done');
    expect(prequal.reviews).toHaveLength(2); // one failed attempt, one recorded review
    expect(new Set(notices.calls.map((c) => c.noticeId)).size).toBe(1);
    expect(notices.delivered.size).toBe(1);
  });
});

describe('leadsNeedingAttention', () => {
  it('lists failed Leads and Leads stuck mid-pipeline, not healthy ones', async () => {
    setup(new Error('down'));
    const failed = await submit({}, 'failed@example.com');
    prequal.next = approved;
    await submit({}, 'healthy@example.com');
    // A Lead stuck in `processing` for longer than the threshold (e.g. a crash mid-call).
    const stuck = await submit({}, 'stuck@example.com');
    const snapshot = leads.snapshots.get(stuck.id)!;
    leads.snapshots.set(stuck.id, {
      ...snapshot,
      status: 'processing',
      updatedAt: new Date('2026-09-22T23:00:00Z'),
    });

    const views = await useCases.leadsNeedingAttention();
    expect(views.map((v) => v.lead.id).sort()).toEqual([failed.id, stuck.id].sort());
  });

  it('lists a decided Lead whose Outcome Notice never went out (crash mid-send)', async () => {
    setup(approved);
    const lead = await submit();
    const snapshot = leads.snapshots.get(lead.id)!;
    leads.snapshots.set(lead.id, {
      ...snapshot,
      notice: { id: snapshot.notice!.id, status: 'pending' },
      updatedAt: new Date('2026-09-22T23:00:00Z'),
    });

    const views = await useCases.leadsNeedingAttention();
    expect(views.map((v) => v.lead.id)).toEqual([lead.id]);
  });
});

describe('submission gate and repeated submissions (ADR-0007)', () => {
  const submitWith = (overrides: Partial<typeof input> = {}, idempotencyKey?: string) =>
    useCases.submitLead({ ...input, ...overrides }, {}, silentLogger, { idempotencyKey });
  const as = (email: string) => ({ borrower: { ...input.borrower, email } });

  it('refuses a second application while the email has an Open Lead', async () => {
    setup(needDocs);
    const open = (await submitWith()).lead;
    expect(open.status).toBe('chase_sent');

    await expect(submitWith(as('JOHN@Example.com'))).rejects.toBeInstanceOf(OpenLeadExistsError);
    await expect(
      submitWith({ property: { ...input.property, estimatedValue: 900_000 } }),
    ).rejects.toBeInstanceOf(OpenLeadExistsError);
    expect(leads.snapshots.size).toBe(1);
    expect(prequal.calls).toHaveLength(1);
    expect(chases.calls).toHaveLength(1);

    // Another borrower is unaffected.
    expect((await submitWith(as('jane@example.com'))).lead.status).toBe('chase_sent');
  });

  it('a failed Lead is still Open: it is resumed by Replay, not by resubmitting', async () => {
    setup(new Error('down'));
    const failed = (await submitWith()).lead;
    expect(failed.status).toBe('failed');
    prequal.next = approved;
    await expect(submitWith()).rejects.toBeInstanceOf(OpenLeadExistsError);
    expect((await replay(failed.id)).status).toBe('approved');
  });

  it('the same answers after a decision return that Lead and send nothing new', async () => {
    setup(approved);
    const first = await submitWith();
    const again = await submitWith(as('John@Example.com'));
    expect(again.duplicate).toBe(true);
    expect(again.lead.id).toBe(first.lead.id);
    expect(prequal.calls).toHaveLength(1);
    expect(notices.calls).toHaveLength(1);
  });

  it('changed answers after a decision start a new application', async () => {
    setup(rejected);
    const first = await submitWith();
    prequal.next = approved;
    const second = await submitWith({
      creditProfile: { creditBand: '780+', incomeBand: '150k-200k' },
    });
    expect(second.duplicate).toBe(false);
    expect(second.lead.id).not.toBe(first.lead.id);
    expect(second.lead.status).toBe('approved');
  });

  it('the same answers more than 24 hours later start a new application', async () => {
    setup(approved);
    const first = (await submitWith()).lead;
    const snapshot = leads.snapshots.get(first.id)!;
    leads.snapshots.set(first.id, { ...snapshot, createdAt: new Date('2026-09-21T23:00:00Z') });
    const again = await submitWith();
    expect(again.duplicate).toBe(false);
    expect(again.lead.id).not.toBe(first.id);
  });

  it('a retry with the same idempotency key returns the same Lead, even while it is Open', async () => {
    setup(needDocs);
    const first = await submitWith({}, 'key-00000001');
    const retry = await submitWith({}, 'key-00000001');
    expect(retry).toMatchObject({ duplicate: true });
    expect(retry.lead.id).toBe(first.lead.id);
    expect(chases.calls).toHaveLength(1);
  });

  it('refuses an idempotency key reused with different answers', async () => {
    setup(approved);
    await submitWith({}, 'key-00000001');
    await expect(
      submitWith({ purpose: 'debt_consolidation' }, 'key-00000001'),
    ).rejects.toBeInstanceOf(IdempotencyKeyReusedError);
    await expect(submitWith(as('jane@example.com'), 'key-00000001')).rejects.toBeInstanceOf(
      IdempotencyKeyReusedError,
    );
  });

  it('two concurrent retries of one submission create one Lead', async () => {
    setup(needDocs);
    const [a, b] = await Promise.all([
      submitWith({}, 'key-00000001'),
      submitWith({}, 'key-00000001'),
    ]);
    expect(a.lead.id).toBe(b.lead.id);
    expect([a.duplicate, b.duplicate].sort()).toEqual([false, true]);
    expect(leads.snapshots.size).toBe(1);
    expect(chases.calls).toHaveLength(1);
  });

  it('two concurrent submissions without a key: one wins, the other is refused', async () => {
    setup(needDocs);
    const results = await Promise.allSettled([submitWith(), submitWith()]);
    expect(results.map((r) => r.status).sort()).toEqual(['fulfilled', 'rejected']);
    expect(results.find((r) => r.status === 'rejected')).toMatchObject({
      reason: expect.any(OpenLeadExistsError),
    });
    expect(chases.calls).toHaveLength(1);
  });
});
