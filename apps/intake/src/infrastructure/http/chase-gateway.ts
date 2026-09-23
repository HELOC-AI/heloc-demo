import {
  chaseResponseSchema,
  outcomeNoticeResponseSchema,
  type ChaseRequest as ChaseRequestDto,
  type OutcomeNoticeRequest,
} from '@heloc/contracts';
import type { ServiceClient } from '@heloc/server-kit';
import type {
  ChaseGateway,
  ChaseRequest,
  Clock,
  NoticeGateway,
  NoticeRequest,
  RequestContext,
} from '../../application/ports.ts';
import type { ChaseDelivery, NoticeDelivery } from '../../domain/model.ts';

/** Borrower Outreach: sends the Chase asking for documents. */
export class ChaseHttpGateway implements ChaseGateway {
  readonly #client: ServiceClient;
  readonly #clock: Clock;

  constructor(client: ServiceClient, clock: Clock) {
    this.#client = client;
    this.#clock = clock;
  }

  async send(request: ChaseRequest, context: RequestContext): Promise<ChaseDelivery> {
    const body: ChaseRequestDto = {
      chase_id: request.chaseId,
      lead_id: request.leadId,
      email: request.borrowerEmail,
      name: request.borrowerName,
      missing_documents: request.missingDocuments as ChaseRequestDto['missing_documents'],
    };
    const response = await this.#client.post('/v1/chases', body, {
      responseSchema: chaseResponseSchema,
      requestId: context.requestId,
    });
    return {
      subject: response.subject,
      body: response.body,
      emailMessageId: response.email_message_id,
      replyTo: response.reply_to,
      sentAt: this.#clock.now(),
    };
  }
}

/** Borrower Outreach: tells the borrower the Document Review's result. */
export class OutcomeNoticeHttpGateway implements NoticeGateway {
  readonly #client: ServiceClient;
  readonly #clock: Clock;

  constructor(client: ServiceClient, clock: Clock) {
    this.#client = client;
    this.#clock = clock;
  }

  async sendNotice(request: NoticeRequest, context: RequestContext): Promise<NoticeDelivery> {
    const { outcome } = request;
    const body: OutcomeNoticeRequest = {
      notice_id: request.noticeId,
      lead_id: request.leadId,
      email: request.borrowerEmail,
      name: request.borrowerName,
      outcome:
        outcome.outcome === 'approved'
          ? {
              status: 'approved',
              offer: {
                lender: outcome.offer.lender,
                amount: outcome.offer.amount,
                apr_min: outcome.offer.aprMin,
                apr_max: outcome.offer.aprMax,
                term_months: outcome.offer.termMonths,
                estimated_monthly_payment: outcome.offer.estimatedMonthlyPayment,
                expires_at: outcome.offer.expiresAt.toISOString(),
              },
            }
          : {
              status: 'rejected',
              reason: outcome.reason as Extract<
                OutcomeNoticeRequest['outcome'],
                { status: 'rejected' }
              >['reason'],
            },
      result_url: request.resultUrl,
    };
    const response = await this.#client.post('/v1/outcome-notices', body, {
      responseSchema: outcomeNoticeResponseSchema,
      requestId: context.requestId,
    });
    return {
      subject: response.subject,
      body: response.body,
      emailMessageId: response.email_message_id,
      sentAt: this.#clock.now(),
    };
  }
}
