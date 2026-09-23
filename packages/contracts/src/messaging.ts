import { z } from 'zod';
import { offerSchema, REJECTION_REASONS } from './figure.ts';
import { missingDocumentSchema } from './lead.ts';

// intake → chase

export const chaseRequestSchema = z.object({
  /** Created by intake before calling chase; drives the email idempotency key. */
  chase_id: z.uuid(),
  lead_id: z.uuid(),
  email: z.email(),
  name: z.string().min(1),
  missing_documents: z.array(missingDocumentSchema).min(1),
});
export type ChaseRequest = z.infer<typeof chaseRequestSchema>;

export const chaseResponseSchema = z.object({
  chase_id: z.uuid(),
  status: z.literal('sent'),
  subject: z.string(),
  body: z.string(),
  email_message_id: z.string(),
  /** The Reply Address the borrower answers with documents. */
  reply_to: z.email(),
});
export type ChaseResponse = z.infer<typeof chaseResponseSchema>;

export const chaseIdempotencyKey = (chaseId: string) => `chase:${chaseId}`;

// chase → email

export const sendEmailRequestSchema = z.object({
  to: z.email(),
  subject: z.string().min(1).max(998),
  html: z.string().min(1),
  text: z.string().min(1),
  /** Where replies should go, e.g. a Chase reply address. */
  reply_to: z.email().optional(),
});
export type SendEmailRequest = z.infer<typeof sendEmailRequestSchema>;

export const sendEmailResponseSchema = z.object({
  message_id: z.string(),
  status: z.literal('accepted'),
});
export type SendEmailResponse = z.infer<typeof sendEmailResponseSchema>;

// intake → chase: tell the borrower the result of the document review

export const outcomeNoticeRequestSchema = z.object({
  notice_id: z.uuid(),
  lead_id: z.uuid(),
  email: z.email(),
  name: z.string().min(1),
  outcome: z.discriminatedUnion('status', [
    z.object({ status: z.literal('approved'), offer: offerSchema }),
    z.object({ status: z.literal('rejected'), reason: z.enum(REJECTION_REASONS) }),
  ]),
  /** Link to the borrower's result page. */
  result_url: z.url(),
});
export type OutcomeNoticeRequest = z.infer<typeof outcomeNoticeRequestSchema>;

export const outcomeNoticeResponseSchema = z.object({
  notice_id: z.uuid(),
  status: z.literal('sent'),
  subject: z.string(),
  body: z.string(),
  email_message_id: z.string(),
});
export type OutcomeNoticeResponse = z.infer<typeof outcomeNoticeResponseSchema>;

export const noticeIdempotencyKey = (noticeId: string) => `notice:${noticeId}`;

// Chase reply addresses: `reply+<chase_id>@<domain>` (RFC 5233 subaddressing).

const UUID_PATTERN = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';

/** `chaseReplyAddress('reply@linkerclaw.ai', id)` → `reply+<id>@linkerclaw.ai`. */
export function chaseReplyAddress(baseAddress: string, chaseId: string): string {
  const [local, domain] = baseAddress.split('@');
  return `${local}+${chaseId}@${domain}`;
}

/** The chase id a reply was sent to, or undefined if the address is not a Chase reply address. */
export function parseChaseReplyAddress(address: string): string | undefined {
  const match = new RegExp(`^[^+@\\s]+\\+(${UUID_PATTERN})@[^@\\s]+$`, 'i').exec(address.trim());
  return match?.[1]?.toLowerCase();
}
