import { HEADERS, sendEmailRequestSchema, type SendEmailResponse } from '@heloc/contracts';
import { HttpError, parseInput } from '@heloc/server-kit';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ProviderError, type SendEmail } from '../../application/send-email.ts';
import { InvalidEmailError } from '../../domain/outbound-email.ts';

const idempotencyKey = z.string().min(1).max(256).optional();

export function sendRoutes(app: FastifyInstance, { sendEmail }: { sendEmail: SendEmail }) {
  app.post('/send', async (request, reply) => {
    const body = parseInput(sendEmailRequestSchema, request.body);
    const key = parseInput(idempotencyKey, request.headers[HEADERS.idempotencyKey]);

    try {
      const receipt = await sendEmail(
        {
          to: body.to,
          subject: body.subject,
          text: body.text,
          html: body.html,
          replyTo: body.reply_to,
        },
        { idempotencyKey: key },
      );
      request.log.info(
        { event: 'email.accepted', message_id: receipt.messageId, idempotency_key: key },
        'email accepted by provider',
      );
      const response: SendEmailResponse = { message_id: receipt.messageId, status: 'accepted' };
      return reply.code(202).send(response);
    } catch (err) {
      if (err instanceof InvalidEmailError) throw new HttpError(400, 'invalid_email', err.message);
      if (err instanceof ProviderError) {
        request.log.error(
          { event: 'email.failed', provider_error: err.code, idempotency_key: key, err },
          'email provider rejected the email',
        );
        throw new HttpError(502, 'provider_error', err.message, { provider_error: err.code });
      }
      throw err;
    }
  });
}
