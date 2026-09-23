import { HEADERS, sendEmailResponseSchema } from '@heloc/contracts';
import type { ServiceClient } from '@heloc/server-kit';
import type { Delivery, EmailGateway } from '../application/send-chase.ts';
import type { ChaseMessage } from '../domain/chase.ts';

export class EmailHttpGateway implements EmailGateway {
  readonly #client: ServiceClient;

  constructor(client: ServiceClient) {
    this.#client = client;
  }

  async send(
    to: string,
    message: ChaseMessage,
    options: {
      idempotencyKey: string;
      replyTo?: string | undefined;
      requestId?: string | undefined;
    },
  ): Promise<Delivery> {
    const response = await this.#client.post(
      '/v1/send',
      {
        to,
        subject: message.subject,
        text: message.text,
        html: message.html,
        ...(options.replyTo && { reply_to: options.replyTo }),
      },
      {
        responseSchema: sendEmailResponseSchema,
        requestId: options.requestId,
        headers: { [HEADERS.idempotencyKey]: options.idempotencyKey },
      },
    );
    return { messageId: response.message_id };
  }
}
