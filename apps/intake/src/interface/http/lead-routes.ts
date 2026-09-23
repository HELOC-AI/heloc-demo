import { HEADERS, leadInputSchema, MOCK_FAULTS, MOCK_OUTCOMES } from '@heloc/contracts';
import { HttpError, parseInput } from '@heloc/server-kit';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  LeadNotFoundError,
  type LeadUseCases,
  type LeadView,
} from '../../application/lead-use-cases.ts';
import type { RequestContext } from '../../application/ports.ts';
import { ConcurrencyError } from '../../domain/lead-repository.ts';
import { DomainError } from '../../domain/model.ts';
import { toLeadResult } from './lead-presenter.ts';

export interface LeadRouteOptions {
  useCases: LeadUseCases;
  /** Honour X-Mock-Outcome / X-Mock-Fault (demo only). */
  allowMockOverride: boolean;
}

const idParams = z.object({ id: z.string() });

export function leadRoutes(
  app: FastifyInstance,
  { useCases, allowMockOverride }: LeadRouteOptions,
) {
  const contextOf = (request: FastifyRequest): RequestContext => ({
    requestId: request.id,
    scenario: allowMockOverride ? scenarioOf(request) : undefined,
  });

  app.post('/leads', async (request, reply) => {
    const body = parseInput(leadInputSchema, request.body);
    const view = await translateErrors(() =>
      useCases.submitLead(
        {
          borrower: { name: body.name, email: body.email, phone: body.phone },
          property: {
            state: body.property_state,
            estimatedValue: body.estimated_home_value,
            mortgageBalance: body.mortgage_balance,
          },
          creditProfile: { creditBand: body.credit_band, incomeBand: body.income_band },
          purpose: body.purpose,
        },
        contextOf(request),
        request.log,
      ),
    );
    return reply.code(failed(view) ? 502 : 201).send(toLeadResult(view));
  });

  app.get('/leads/:id', async (request) => {
    const { id } = parseInput(idParams, request.params);
    return toLeadResult(await translateErrors(() => useCases.getLead(id)));
  });

  app.post('/leads/:id/replay', async (request, reply) => {
    const { id } = parseInput(idParams, request.params);
    const view = await translateErrors(() =>
      useCases.replayLead(id, contextOf(request), request.log),
    );
    return reply.code(failed(view) ? 502 : 200).send(toLeadResult(view));
  });
}

const failed = (view: LeadView) => view.lead.status === 'failed';

async function translateErrors<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof LeadNotFoundError) throw new HttpError(404, 'lead_not_found', err.message);
    if (err instanceof ConcurrencyError) throw new HttpError(409, err.code, err.message);
    if (err instanceof DomainError) throw new HttpError(422, err.code, err.message);
    throw err;
  }
}

const outcomeHeader = z.enum(MOCK_OUTCOMES).optional();
const faultHeader = z.enum(MOCK_FAULTS).optional();
const FORCED: Record<
  (typeof MOCK_OUTCOMES)[number],
  'approved' | 'rejected' | 'need_more_documents'
> = { approved: 'approved', rejected: 'rejected', 'need-more-documents': 'need_more_documents' };

function scenarioOf(request: FastifyRequest): RequestContext['scenario'] {
  const header = (name: string) => {
    const value = request.headers[name];
    return typeof value === 'string' && value !== '' ? value : undefined;
  };
  const outcome = parseInput(outcomeHeader, header(HEADERS.mockOutcome));
  const fault = parseInput(faultHeader, header(HEADERS.mockFault));
  if (!outcome && !fault) return undefined;
  return { forcedOutcome: outcome && FORCED[outcome], fault };
}
