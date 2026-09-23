/**
 * Email Delivery domain (see ../../CONTEXT.md). Knows nothing about Leads or Chases.
 */

export interface OutboundEmail {
  to: string;
  subject: string;
  text: string;
  html: string;
  /** Where the recipient's reply should go. */
  replyTo?: string | undefined;
}

export interface DeliveryReceipt {
  /** Provider's id; use it to trace delivery in the provider dashboard. */
  messageId: string;
}

export class InvalidEmailError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidEmailError';
  }
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function outboundEmail(input: OutboundEmail): OutboundEmail {
  if (!EMAIL.test(input.to)) throw new InvalidEmailError('to: not an email address');
  if (input.replyTo !== undefined && !EMAIL.test(input.replyTo)) {
    throw new InvalidEmailError('reply_to: not an email address');
  }
  // A line break in a header value would let a caller inject extra headers.
  if (!input.subject.trim() || /[\r\n]/.test(input.subject)) {
    throw new InvalidEmailError('subject: must be a single non-empty line');
  }
  if (!input.text.trim() || !input.html.trim()) {
    throw new InvalidEmailError('text and html bodies are required');
  }
  return { ...input, subject: input.subject.trim() };
}
