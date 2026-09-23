import { randomUUID } from 'node:crypto';
import type { Logger } from '@heloc/logger';
import type { EmailProvider, SendOptions } from '../application/send-email.ts';
import type { DeliveryReceipt, OutboundEmail } from '../domain/outbound-email.ts';

/** Local development: logs instead of sending. Honours idempotency like a real provider. */
export class ConsoleProvider implements EmailProvider {
  readonly name = 'console';
  readonly #logger: Logger;
  readonly #sent = new Map<string, DeliveryReceipt>();

  constructor(logger: Logger) {
    this.#logger = logger;
  }

  async send(email: OutboundEmail, from: string, options: SendOptions): Promise<DeliveryReceipt> {
    const previous = options.idempotencyKey && this.#sent.get(options.idempotencyKey);
    if (previous) return previous;
    const receipt = { messageId: `console_${randomUUID()}` };
    if (options.idempotencyKey) this.#sent.set(options.idempotencyKey, receipt);
    this.#logger.info(
      { event: 'email.console', from, subject: email.subject, text: email.text },
      'email not sent (console provider)',
    );
    return receipt;
  }
}
