/** In-memory adapters for application and interface tests. */
import {
  ConcurrencyError,
  type LeadRepository,
  type SaveOptions,
} from '../domain/lead-repository.ts';
import { Lead, type LeadSnapshot } from '../domain/lead.ts';
import type {
  ChaseDelivery,
  NoticeDelivery,
  PrequalDecision,
  ReviewDecision,
} from '../domain/model.ts';
import type {
  AppLogger,
  ChaseGateway,
  ChaseRequest,
  LeadTimeline,
  NoticeGateway,
  NoticeRequest,
  PrequalGateway,
  PrequalRequest,
  RecordedLeadEvent,
  RequestContext,
  ReviewRequest,
} from '../application/ports.ts';

export class InMemoryLeads implements LeadRepository, LeadTimeline {
  readonly snapshots = new Map<string, LeadSnapshot>();
  readonly events: RecordedLeadEvent[] = [];
  readonly rawResponses = new Map<string, unknown>();

  async findById(id: string) {
    const snapshot = this.snapshots.get(id);
    return snapshot && Lead.rehydrate(snapshot);
  }

  async findByChaseId(chaseId: string) {
    const snapshot = [...this.snapshots.values()].find((s) => s.chase?.id === chaseId);
    return snapshot && Lead.rehydrate(snapshot);
  }

  async save(lead: Lead, options?: SaveOptions) {
    const stored = this.snapshots.get(lead.id);
    if ((stored?.version ?? 0) !== lead.version) throw new ConcurrencyError(lead.id);
    this.snapshots.set(lead.id, { ...lead.snapshot(), version: lead.version + 1 });
    for (const event of lead.pendingEvents()) {
      this.events.push({ ...event, id: `evt-${this.events.length + 1}` });
    }
    if (options?.rawFigureResponse !== undefined) {
      this.rawResponses.set(lead.id, options.rawFigureResponse);
    }
    lead.markPersisted();
  }

  async needingAttention(stuckBefore: Date, limit: number) {
    return [...this.snapshots.values()]
      .filter(
        (s) =>
          s.status === 'failed' ||
          (['submitted', 'processing', 'documents_received'].includes(s.status) &&
            s.updatedAt < stuckBefore),
      )
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
      .slice(0, limit)
      .map((s) => s.id);
  }

  async eventsFor(leadId: string) {
    return this.events.filter((e) => e.leadId === leadId);
  }
}

export class FakePrequal implements PrequalGateway {
  readonly calls: { request: PrequalRequest; context: RequestContext }[] = [];
  readonly reviews: ReviewRequest[] = [];
  next: PrequalDecision | Error;
  nextReview: ReviewDecision | Error = {
    outcome: 'approved',
    offer: {
      lender: 'Figure mock',
      amount: 250_000,
      aprMin: 7.5,
      aprMax: 9.5,
      termMonths: 120,
      estimatedMonthlyPayment: 2_968,
      expiresAt: new Date('2026-10-23T00:00:00Z'),
    },
  };

  constructor(next: PrequalDecision | Error) {
    this.next = next;
  }

  async softPull(request: PrequalRequest, context: RequestContext) {
    this.calls.push({ request, context });
    if (this.next instanceof Error) throw this.next;
    return { decision: this.next, rawResponse: { fake: true, outcome: this.next.outcome } };
  }

  async reviewDocuments(request: ReviewRequest) {
    this.reviews.push(request);
    if (this.nextReview instanceof Error) throw this.nextReview;
    return {
      decision: this.nextReview,
      rawResponse: { fake: true, review: this.nextReview.outcome },
    };
  }
}

export class FakeNotices implements NoticeGateway {
  readonly calls: NoticeRequest[] = [];
  /** Notices that actually "went out", keyed by notice id (the idempotency key). */
  readonly delivered = new Map<string, NoticeDelivery>();
  failWith: Error | undefined;

  async sendNotice(request: NoticeRequest) {
    this.calls.push(request);
    if (this.failWith) throw this.failWith;
    const existing = this.delivered.get(request.noticeId);
    if (existing) return existing;
    const delivery = {
      subject: request.outcome.outcome === 'approved' ? 'Your HELOC offer is ready' : 'An update',
      body: `Hi ${request.borrowerName}`,
      emailMessageId: `notice_email_${this.delivered.size + 1}`,
      sentAt: new Date('2026-09-23T00:00:02Z'),
    };
    this.delivered.set(request.noticeId, delivery);
    return delivery;
  }
}

export class FakeChases implements ChaseGateway {
  readonly calls: ChaseRequest[] = [];
  /** Emails that actually "went out", keyed by chase id (the idempotency key). */
  readonly delivered = new Map<string, ChaseDelivery>();
  failWith: Error | undefined;

  async send(request: ChaseRequest) {
    this.calls.push(request);
    if (this.failWith) throw this.failWith;
    const existing = this.delivered.get(request.chaseId);
    if (existing) return existing;
    const delivery = {
      subject: 'Additional documents required for your HELOC application',
      body: `Hi ${request.borrowerName}`,
      emailMessageId: `email_${this.delivered.size + 1}`,
      replyTo: `reply+${request.chaseId}@linkerclaw.ai`,
      sentAt: new Date('2026-09-23T00:00:01Z'),
    };
    this.delivered.set(request.chaseId, delivery);
    return delivery;
  }
}

export const silentLogger: AppLogger = { info() {}, warn() {}, error() {} };

export function sequentialIds(prefix = 'id') {
  let n = 0;
  return { newId: () => `${prefix}-${++n}` };
}
