import {
  outboundEmail,
  type DeliveryReceipt,
  type OutboundEmail,
} from '../domain/outbound-email.ts';

export interface SendOptions {
  /** Same key → the provider sends at most once (e.g. `chase:{chase_id}`). */
  idempotencyKey?: string | undefined;
}

/** Port: the external service that actually delivers mail (Resend, SES, SendGrid, …). */
export interface EmailProvider {
  readonly name: string;
  send(email: OutboundEmail, from: string, options: SendOptions): Promise<DeliveryReceipt>;
}

export class ProviderError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'ProviderError';
    this.code = code;
  }
}

export interface SendEmailDeps {
  provider: EmailProvider;
  /** The single Sender every Outbound Email uses; must be on a verified domain. */
  sender: string;
}

export function createSendEmail({ provider, sender }: SendEmailDeps) {
  return async function sendEmail(input: OutboundEmail, options: SendOptions = {}) {
    return provider.send(outboundEmail(input), sender, options);
  };
}
export type SendEmail = ReturnType<typeof createSendEmail>;
