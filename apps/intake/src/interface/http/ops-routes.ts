import type { OpsLeadsResponse } from '@heloc/contracts';
import { parseInput } from '@heloc/server-kit';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { LeadUseCases } from '../../application/lead-use-cases.ts';
import { toLeadResult } from './lead-presenter.ts';

const query = z.object({ limit: z.coerce.number().int().min(1).max(100).default(50) });

/** Operator reads (GET /v1/ops/*), behind OPS_API_KEY. */
export function opsRoutes(app: FastifyInstance, { useCases }: { useCases: LeadUseCases }) {
  app.get('/ops/leads', async (request): Promise<OpsLeadsResponse> => {
    const { limit } = parseInput(query, request.query);
    const views = await useCases.leadsNeedingAttention(limit);
    return {
      leads: views.map((view) => {
        const { events: _events, ...result } = toLeadResult(view);
        return { ...result, updated_at: view.lead.snapshot().updatedAt.toISOString() };
      }),
    };
  });
}
