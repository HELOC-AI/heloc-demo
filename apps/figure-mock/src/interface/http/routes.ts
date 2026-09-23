import {
  documentReviewRequestSchema,
  HEADERS,
  MOCK_FAULTS,
  MOCK_OUTCOMES,
  softPullRequestSchema,
  type DocumentReviewResponse,
  type SoftPullRequest,
  type SoftPullResponse,
} from '@heloc/contracts';
import { HttpError, parseInput } from '@heloc/server-kit';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { runDocumentReview, runSoftPull, type Clock } from '../../application/run-soft-pull.ts';
import type { Offer, Outcome, ReviewOutcome, SoftPull } from '../../domain/soft-pull.ts';

export interface SoftPullRouteOptions {
  clock: Clock;
  /** How long an injected `timeout` fault stalls; longer than any caller's timeout. */
  faultDelayMs: number;
}

const mockOutcome = z.enum(MOCK_OUTCOMES).optional();
const mockFault = z.enum(MOCK_FAULTS).optional();

const reviewOutcome = z.enum(['approved', 'rejected']).optional();

export function softPullRoutes(
  app: FastifyInstance,
  { clock, faultDelayMs }: SoftPullRouteOptions,
) {
  /** Demo faults: `error` → handled 503, `exception` → unhandled 500, `timeout` → stall. */
  async function injectFault(request: FastifyRequest, log: FastifyRequest['log']) {
    const fault = parseInput(mockFault, header(request, HEADERS.mockFault));
    if (!fault) return;
    log.warn({ event: 'soft_pull.fault_injected', fault }, `injected fault: ${fault}`);
    if (fault === 'error') throw new HttpError(503, 'injected_fault', 'Injected fault: error');
    if (fault === 'exception') {
      throw new Error('Injected fault: unhandled exception during soft pull');
    }
    await new Promise((resolve) => setTimeout(resolve, faultDelayMs));
  }

  app.post('/soft-pull', async (request) => {
    const body = parseInput(softPullRequestSchema, request.body);
    const forcedOutcome = parseInput(mockOutcome, header(request, HEADERS.mockOutcome));
    const log = request.log.child({ lead_id: body.lead_id });
    await injectFault(request, log);

    const outcome = runSoftPull({ pull: toSoftPull(body), forcedOutcome }, clock);
    log.info(
      { event: 'soft_pull.completed', outcome: outcome.status, forced: Boolean(forcedOutcome) },
      `soft pull ${outcome.status}`,
    );
    return toResponse(outcome);
  });

  app.post('/document-reviews', async (request) => {
    const body = parseInput(documentReviewRequestSchema, request.body);
    const forcedOutcome = parseInput(reviewOutcome, header(request, HEADERS.mockOutcome));
    const log = request.log.child({ lead_id: body.lead_id });
    await injectFault(request, log);

    const outcome = runDocumentReview({ pull: toSoftPull(body), forcedOutcome }, clock);
    log.info(
      {
        event: 'document_review.completed',
        outcome: outcome.status,
        documents: body.documents.length,
        attachments: body.attachments.length,
        forced: Boolean(forcedOutcome),
      },
      `document review ${outcome.status}`,
    );
    return toReviewResponse(outcome);
  });
}

const toSoftPull = (body: SoftPullRequest): SoftPull => ({
  leadId: body.lead_id,
  propertyState: body.property_state,
  homeValue: body.estimated_home_value,
  mortgageBalance: body.mortgage_balance,
  creditBand: body.credit_band,
  incomeBand: body.income_band,
});

const header = (request: FastifyRequest, name: string) => {
  const value = request.headers[name];
  return typeof value === 'string' && value !== '' ? value : undefined;
};

const toOfferDto = (offer: Offer) => ({
  lender: offer.lender,
  amount: offer.amount,
  apr_min: offer.aprMin,
  apr_max: offer.aprMax,
  term_months: offer.termMonths,
  estimated_monthly_payment: offer.estimatedMonthlyPayment,
  expires_at: offer.expiresAt.toISOString(),
});

function toReviewResponse(outcome: ReviewOutcome): DocumentReviewResponse {
  return outcome.status === 'approved'
    ? { status: 'approved', offer: toOfferDto(outcome.offer) }
    : { status: 'rejected', reason: outcome.reason };
}

function toResponse(outcome: Outcome): SoftPullResponse {
  switch (outcome.status) {
    case 'approved':
      return { status: 'approved', offer: toOfferDto(outcome.offer) };
    case 'rejected':
      return { status: 'rejected', reason: outcome.reason };
    case 'need-more-documents':
      return { status: 'need-more-documents', documents: outcome.documents };
  }
}
