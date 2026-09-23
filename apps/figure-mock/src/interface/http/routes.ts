import {
  HEADERS,
  MOCK_FAULTS,
  MOCK_OUTCOMES,
  softPullRequestSchema,
  type SoftPullResponse,
} from '@heloc/contracts';
import { HttpError, parseInput } from '@heloc/server-kit';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { runSoftPull, type Clock } from '../../application/run-soft-pull.ts';
import type { Outcome } from '../../domain/soft-pull.ts';

export interface SoftPullRouteOptions {
  clock: Clock;
  /** How long an injected `timeout` fault stalls; longer than any caller's timeout. */
  faultDelayMs: number;
}

const mockOutcome = z.enum(MOCK_OUTCOMES).optional();
const mockFault = z.enum(MOCK_FAULTS).optional();

export function softPullRoutes(
  app: FastifyInstance,
  { clock, faultDelayMs }: SoftPullRouteOptions,
) {
  app.post('/soft-pull', async (request) => {
    const body = parseInput(softPullRequestSchema, request.body);
    const forcedOutcome = parseInput(mockOutcome, header(request, HEADERS.mockOutcome));
    const fault = parseInput(mockFault, header(request, HEADERS.mockFault));
    const log = request.log.child({ lead_id: body.lead_id });

    if (fault) {
      log.warn({ event: 'soft_pull.fault_injected', fault }, `injected fault: ${fault}`);
      if (fault === 'error') throw new HttpError(503, 'injected_fault', 'Injected fault: error');
      await new Promise((resolve) => setTimeout(resolve, faultDelayMs));
    }

    const outcome = runSoftPull(
      {
        pull: {
          leadId: body.lead_id,
          propertyState: body.property_state,
          homeValue: body.estimated_home_value,
          mortgageBalance: body.mortgage_balance,
          creditBand: body.credit_band,
          incomeBand: body.income_band,
        },
        forcedOutcome,
      },
      clock,
    );
    log.info(
      { event: 'soft_pull.completed', outcome: outcome.status, forced: Boolean(forcedOutcome) },
      `soft pull ${outcome.status}`,
    );
    return toResponse(outcome);
  });
}

const header = (request: FastifyRequest, name: string) => {
  const value = request.headers[name];
  return typeof value === 'string' && value !== '' ? value : undefined;
};

function toResponse(outcome: Outcome): SoftPullResponse {
  switch (outcome.status) {
    case 'approved': {
      const { offer } = outcome;
      return {
        status: 'approved',
        offer: {
          lender: offer.lender,
          amount: offer.amount,
          apr_min: offer.aprMin,
          apr_max: offer.aprMax,
          term_months: offer.termMonths,
          estimated_monthly_payment: offer.estimatedMonthlyPayment,
          expires_at: offer.expiresAt.toISOString(),
        },
      };
    }
    case 'rejected':
      return { status: 'rejected', reason: outcome.reason };
    case 'need-more-documents':
      return { status: 'need-more-documents', documents: outcome.documents };
  }
}
