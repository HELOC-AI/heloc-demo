import { z } from 'zod';
import { submittedAttachmentSchema } from './figure.ts';

/**
 * An email received on our domain, as reported by the inbound adapter
 * (Cloudflare Email Worker). Provider-neutral; carries metadata only — attachment
 * contents never leave the adapter.
 */
export const inboundEmailSchema = z.object({
  /** RFC Message-ID; used to ignore redeliveries of the same email. */
  message_id: z.string().min(1),
  received_at: z.iso.datetime(),
  /** Bare address from the From header. */
  from: z.email(),
  /** The recipient address the email was delivered to (with any +subaddress). */
  to: z.email(),
  subject: z.string(),
  /**
   * The receiving mail server's own verdict (Cloudflare's Authentication-Results),
   * not a header the sender could forge. `pass` = DMARC passed for the From domain.
   */
  authentication: z.object({
    dmarc: z.enum(['pass', 'fail', 'none', 'unknown']),
    /** The raw verdict, for audit. */
    detail: z.string(),
  }),
  /** Real attachments only (not inline images). */
  attachments: z.array(
    submittedAttachmentSchema.extend({ sha256: z.string().regex(/^[0-9a-f]{64}$/) }),
  ),
});
export type InboundEmail = z.infer<typeof inboundEmailSchema>;

/** Why a Chase Reply was not accepted (also the `reason` on `documents.rejected` events). */
export const REPLY_REJECTIONS = [
  'chase_not_sent',
  'already_received',
  'not_authenticated',
  'sender_mismatch',
  'no_attachments',
] as const;
export type ReplyRejection = (typeof REPLY_REJECTIONS)[number];

export const inboundEmailResponseSchema = z.object({
  /** false when the email was ignored (not a Chase reply) or refused (see reason). */
  accepted: z.boolean(),
  reason: z.string().optional(),
  lead_id: z.uuid().optional(),
});
export type InboundEmailResponse = z.infer<typeof inboundEmailResponseSchema>;
