import { Resend } from 'resend';
import { ProviderError, type EmailProvider, type SendOptions } from '../application/send-email.ts';
import type { DeliveryReceipt, OutboundEmail } from '../domain/outbound-email.ts';

export class ResendProvider implements EmailProvider {
  readonly name = 'resend';
  readonly #resend: Resend;

  constructor(apiKey: string) {
    this.#resend = new Resend(apiKey);
  }

  async send(email: OutboundEmail, from: string, options: SendOptions): Promise<DeliveryReceipt> {
    const { data, error } = await this.#resend.emails.send(
      {
        from,
        to: [email.to],
        subject: email.subject,
        text: email.text,
        html: email.html,
        ...(email.replyTo && { replyTo: email.replyTo }),
      },
      options.idempotencyKey ? { idempotencyKey: options.idempotencyKey } : undefined,
    );
    if (error) throw new ProviderError(error.name, `resend: ${error.message}`);
    return { messageId: data.id };
  }
}
