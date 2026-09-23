import {
  chaseRequestSchema,
  outcomeNoticeRequestSchema,
  type ChaseResponse,
  type OutcomeNoticeResponse,
} from '@heloc/contracts';
import { HttpError, parseInput, UpstreamError } from '@heloc/server-kit';
import type { FastifyBaseLogger, FastifyInstance } from 'fastify';
import type { SendChase, SendOutcomeNotice } from '../../application/send-chase.ts';

export interface ChaseRouteDeps {
  sendChase: SendChase;
  sendOutcomeNotice: SendOutcomeNotice;
}

/** Email Delivery being down is a dependency failure (502), not our bug (500). */
async function viaEmail<T>(log: FastifyBaseLogger, event: string, fn: () => Promise<T>) {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof UpstreamError) {
      log.error({ event, err }, 'email service call failed');
      throw new HttpError(502, 'email_unavailable', err.message);
    }
    throw err;
  }
}

export function chaseRoutes(
  app: FastifyInstance,
  { sendChase, sendOutcomeNotice }: ChaseRouteDeps,
) {
  app.post('/chases', async (request) => {
    const body = parseInput(chaseRequestSchema, request.body);
    const log = request.log.child({ lead_id: body.lead_id, chase_id: body.chase_id });

    const sent = await viaEmail(log, 'chase.failed', () =>
      sendChase({
        chaseId: body.chase_id,
        leadId: body.lead_id,
        borrower: { name: body.name, email: body.email },
        missingDocuments: body.missing_documents,
        requestId: request.id,
      }),
    );
    log.info(
      {
        event: 'chase.sent',
        email_message_id: sent.messageId,
        documents: body.missing_documents.length,
      },
      'chase sent',
    );

    const response: ChaseResponse = {
      chase_id: sent.chaseId,
      status: 'sent',
      subject: sent.message.subject,
      body: sent.message.text,
      email_message_id: sent.messageId,
      reply_to: sent.replyAddress,
    };
    return response;
  });

  app.post('/outcome-notices', async (request) => {
    const body = parseInput(outcomeNoticeRequestSchema, request.body);
    const log = request.log.child({ lead_id: body.lead_id, notice_id: body.notice_id });
    const { outcome } = body;

    const sent = await viaEmail(log, 'notice.failed', () =>
      sendOutcomeNotice({
        noticeId: body.notice_id,
        leadId: body.lead_id,
        borrower: { name: body.name, email: body.email },
        outcome:
          outcome.status === 'approved'
            ? {
                status: 'approved',
                offer: {
                  lender: outcome.offer.lender,
                  amount: outcome.offer.amount,
                  aprMin: outcome.offer.apr_min,
                  aprMax: outcome.offer.apr_max,
                  termMonths: outcome.offer.term_months,
                  estimatedMonthlyPayment: outcome.offer.estimated_monthly_payment,
                  expiresAt: new Date(outcome.offer.expires_at),
                },
              }
            : { status: 'rejected', reason: outcome.reason },
        basis: body.basis,
        resultUrl: body.result_url,
        requestId: request.id,
      }),
    );
    log.info(
      {
        event: 'notice.sent',
        outcome: outcome.status,
        basis: body.basis,
        email_message_id: sent.messageId,
      },
      'outcome notice sent',
    );

    const response: OutcomeNoticeResponse = {
      notice_id: sent.noticeId,
      status: 'sent',
      subject: sent.message.subject,
      body: sent.message.text,
      email_message_id: sent.messageId,
    };
    return response;
  });
}
