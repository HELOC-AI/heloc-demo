import { chaseRequestSchema, type ChaseResponse } from '@heloc/contracts';
import { HttpError, parseInput, UpstreamError } from '@heloc/server-kit';
import type { FastifyInstance } from 'fastify';
import type { SendChase } from '../../application/send-chase.ts';

export function chaseRoutes(app: FastifyInstance, { sendChase }: { sendChase: SendChase }) {
  app.post('/chases', async (request) => {
    const body = parseInput(chaseRequestSchema, request.body);
    const log = request.log.child({ lead_id: body.lead_id, chase_id: body.chase_id });

    let sent;
    try {
      sent = await sendChase({
        chaseId: body.chase_id,
        leadId: body.lead_id,
        borrower: { name: body.name, email: body.email },
        missingDocuments: body.missing_documents,
        requestId: request.id,
      });
    } catch (err) {
      if (err instanceof UpstreamError) {
        log.error({ event: 'chase.failed', err }, 'email service call failed');
        throw new HttpError(502, 'email_unavailable', err.message);
      }
      throw err;
    }
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
    };
    return response;
  });
}
