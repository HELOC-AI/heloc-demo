import { z } from 'zod';
import { CREDIT_BANDS, INCOME_BANDS, PURPOSES, US_STATES } from './common.ts';
import { DOCUMENT_TYPES, offerSchema } from './figure.ts';

/**
 * Accepts common US formats ("(415) 555-1234", "415.555.1234", "+1 415 555 1234")
 * and normalizes to E.164.
 */
export const phoneSchema = z
  .string()
  .trim()
  .transform((raw) => {
    const digits = raw.replace(/[^\d+]/g, '');
    if (/^\d{10}$/.test(digits)) return `+1${digits}`;
    if (/^1\d{10}$/.test(digits)) return `+${digits}`;
    return digits;
  })
  .pipe(z.string().regex(/^\+[1-9]\d{7,14}$/, 'Enter a valid phone number'));

/** A document the borrower still has to provide, and why (Lead Intake language). */
export const missingDocumentSchema = z.object({
  type: z.enum(DOCUMENT_TYPES),
  reason: z.string(),
});
export type MissingDocument = z.infer<typeof missingDocumentSchema>;

const usd = z.number().finite().nonnegative().max(100_000_000);

export const leadInputSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(200),
  email: z.email('Enter a valid email').max(320),
  phone: phoneSchema,
  property_state: z.enum(US_STATES),
  estimated_home_value: usd.positive('Home value must be greater than 0'),
  mortgage_balance: usd,
  credit_band: z.enum(CREDIT_BANDS),
  income_band: z.enum(INCOME_BANDS),
  purpose: z.enum(PURPOSES),
});
export type LeadInput = z.output<typeof leadInputSchema>;
/** What a form holds before normalization (e.g. raw phone string). */
export type LeadFormValues = z.input<typeof leadInputSchema>;

export const LEAD_STATUSES = [
  'submitted',
  'processing',
  'approved',
  'rejected',
  'need_more_documents',
  'chase_sent',
  'failed',
] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];

export const LEAD_EVENT_TYPES = [
  'lead.created',
  'lead.replayed',
  'lead.failed',
  'figure.requested',
  'figure.approved',
  'figure.rejected',
  'figure.need_more_documents',
  'chase.created',
  'email.sent',
  'email.failed',
] as const;
export type LeadEventType = (typeof LEAD_EVENT_TYPES)[number];

/** Response of POST /v1/leads, POST /v1/leads/:id/replay and GET /v1/leads/:id. */
export const leadResultSchema = z.object({
  lead_id: z.uuid(),
  status: z.enum(LEAD_STATUSES),
  offer: offerSchema.optional(),
  reason: z.string().optional(),
  documents: z.array(missingDocumentSchema).optional(),
  chase: z
    .object({
      status: z.enum(['pending', 'sent', 'failed']),
      sent_at: z.iso.datetime().nullable(),
    })
    .optional(),
  /** Why the Lead is `failed`; replay resumes from the failed step. */
  error: z.string().optional(),
  /** The Lead's execution chain, oldest first. */
  events: z
    .array(
      z.object({
        type: z.enum(LEAD_EVENT_TYPES),
        payload: z.record(z.string(), z.unknown()),
        created_at: z.iso.datetime(),
      }),
    )
    .optional(),
});
export type LeadResult = z.infer<typeof leadResultSchema>;
