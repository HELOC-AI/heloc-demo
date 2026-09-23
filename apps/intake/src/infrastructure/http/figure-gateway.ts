import {
  HEADERS,
  softPullResponseSchema,
  type MockOutcome,
  type SoftPullRequest,
  type SoftPullResponse,
} from '@heloc/contracts';
import type { ServiceClient } from '@heloc/server-kit';
import type {
  PrequalGateway,
  PrequalRequest,
  PrequalResult,
  PrequalScenario,
  RequestContext,
} from '../../application/ports.ts';
import type { PrequalDecision } from '../../domain/model.ts';

/**
 * Anti-corruption layer to Prequalification (Figure). Figure's language —
 * `need-more-documents`, `documents`, snake_case offers — stops here.
 */
export class FigureHttpGateway implements PrequalGateway {
  readonly #client: ServiceClient;

  constructor(client: ServiceClient) {
    this.#client = client;
  }

  async softPull(request: PrequalRequest, context: RequestContext): Promise<PrequalResult> {
    const body: SoftPullRequest = {
      lead_id: request.leadId,
      property_state: request.propertyState as SoftPullRequest['property_state'],
      estimated_home_value: request.estimatedValue,
      mortgage_balance: request.mortgageBalance,
      credit_band: request.creditBand as SoftPullRequest['credit_band'],
      income_band: request.incomeBand as SoftPullRequest['income_band'],
    };
    const response = await this.#client.post('/v1/soft-pull', body, {
      responseSchema: softPullResponseSchema,
      requestId: context.requestId,
      headers: scenarioHeaders(context.scenario),
    });
    return { decision: toDecision(response), rawResponse: response };
  }
}

export function toDecision(response: SoftPullResponse): PrequalDecision {
  switch (response.status) {
    case 'approved': {
      const { offer } = response;
      return {
        outcome: 'approved',
        offer: {
          lender: offer.lender,
          amount: offer.amount,
          aprMin: offer.apr_min,
          aprMax: offer.apr_max,
          termMonths: offer.term_months,
          estimatedMonthlyPayment: offer.estimated_monthly_payment,
          expiresAt: new Date(offer.expires_at),
        },
      };
    }
    case 'rejected':
      return { outcome: 'rejected', reason: response.reason };
    case 'need-more-documents':
      return { outcome: 'need_more_documents', missingDocuments: response.documents };
  }
}

const FIGURE_OUTCOME: Record<NonNullable<PrequalScenario['forcedOutcome']>, MockOutcome> = {
  approved: 'approved',
  rejected: 'rejected',
  need_more_documents: 'need-more-documents',
};

function scenarioHeaders(scenario: PrequalScenario | undefined) {
  return {
    [HEADERS.mockOutcome]: scenario?.forcedOutcome && FIGURE_OUTCOME[scenario.forcedOutcome],
    [HEADERS.mockFault]: scenario?.fault,
  };
}
