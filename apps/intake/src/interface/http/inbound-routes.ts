import {
  inboundEmailSchema,
  parseChaseReplyAddress,
  type InboundEmailResponse,
} from '@heloc/contracts';
import { parseInput } from '@heloc/server-kit';
import type { FastifyBaseLogger, FastifyInstance } from 'fastify';
import type { LeadUseCases } from '../../application/lead-use-cases.ts';

export interface InboundRouteOptions {
  useCases: LeadUseCases;
  logger: FastifyBaseLogger;
  /** Receives the background continuation of an accepted reply (tests await it). */
  onBackground?: (work: Promise<unknown>) => void;
}

/**
 * Emails received on our domain, reported by the inbound adapter (Cloudflare Email
 * Worker). A Chase Reply is recorded synchronously; the Lead then continues (Document
 * Review → Outcome Notice) in the background so the adapter gets a quick 202.
 */
export function inboundRoutes(
  app: FastifyInstance,
  { useCases, logger, onBackground }: InboundRouteOptions,
) {
  app.post('/inbound-emails', async (request, reply) => {
    const email = parseInput(inboundEmailSchema, request.body);
    const answer = (body: InboundEmailResponse) => reply.code(202).send(body);

    const chaseId = parseChaseReplyAddress(email.to);
    if (!chaseId) {
      request.log.warn({ event: 'inbound.ignored', reason: 'not_a_chase_reply' }, 'ignored');
      return answer({ accepted: false, reason: 'not_a_chase_reply' });
    }

    const result = await useCases.receiveChaseReply(
      chaseId,
      {
        messageId: email.message_id,
        receivedAt: new Date(email.received_at),
        from: email.from,
        dmarc: email.authentication.dmarc,
        attachments: email.attachments.map((a) => ({
          filename: a.filename,
          contentType: a.content_type,
          size: a.size,
          sha256: a.sha256,
        })),
      },
      request.log,
    );

    if (!result.outcome.accepted || result.leadId === undefined) {
      const reason = result.outcome.accepted ? 'unknown_chase' : result.outcome.reason;
      request.log.warn(
        { event: 'inbound.refused', chase_id: chaseId, lead_id: result.leadId, reason },
        'chase reply refused',
      );
      return answer({ accepted: false, reason, lead_id: result.leadId });
    }

    const log = logger.child({ request_id: request.id, lead_id: result.leadId });
    const work = useCases
      .continueLead(result.leadId, { requestId: request.id }, log)
      .catch((err: unknown) =>
        log.error({ event: 'lead.continue_failed', err }, 'continuing lead after reply failed'),
      );
    onBackground?.(work);
    return answer({ accepted: true, lead_id: result.leadId });
  });
}
