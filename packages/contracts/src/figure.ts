import { z } from 'zod';
import { CREDIT_BANDS, INCOME_BANDS, US_STATES } from './common.ts';

export const MOCK_OUTCOMES = ['approved', 'rejected', 'need-more-documents'] as const;
export type MockOutcome = (typeof MOCK_OUTCOMES)[number];

/**
 * Injected failures, used to demo failure modes and replay: `timeout` stalls, `error`
 * returns a handled 503, `exception` throws an unhandled error (shows up in Better Stack Errors).
 */
export const MOCK_FAULTS = ['timeout', 'error', 'exception'] as const;
export type MockFault = (typeof MOCK_FAULTS)[number];

export const DOCUMENT_TYPES = [
  'income_verification',
  'employment_verification',
  'mortgage_statement',
  'property_valuation',
  'identity_verification',
] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];

/** Why Figure declines; published so clients can explain each one. */
export const REJECTION_REASONS = ['insufficient_home_equity', 'credit_below_minimum'] as const;
export type RejectionReason = (typeof REJECTION_REASONS)[number];

/**
 * HELOC product limits Figure (mock) underwrites against. Published so the quiz can
 * preview available equity with the same numbers the underwriter uses.
 */
export const HELOC_LIMITS = {
  /** First mortgage + line may not exceed this share of the home's value. */
  maxCombinedLtv: 0.85,
  /** Smallest line worth offering, USD. */
  minLine: 25_000,
  /** Largest line offered, USD. */
  maxLine: 400_000,
} as const;

export const softPullRequestSchema = z.object({
  lead_id: z.uuid(),
  property_state: z.enum(US_STATES),
  estimated_home_value: z.number().positive(),
  mortgage_balance: z.number().nonnegative(),
  credit_band: z.enum(CREDIT_BANDS),
  income_band: z.enum(INCOME_BANDS),
});
export type SoftPullRequest = z.infer<typeof softPullRequestSchema>;

export const offerSchema = z.object({
  lender: z.string(),
  amount: z.number(),
  apr_min: z.number(),
  apr_max: z.number(),
  term_months: z.number().int(),
  estimated_monthly_payment: z.number(),
  expires_at: z.iso.datetime(),
});
export type Offer = z.infer<typeof offerSchema>;

/** Figure's term for a document it needs; Lead Intake translates it into a Missing Document. */
export const requiredDocumentSchema = z.object({
  type: z.enum(DOCUMENT_TYPES),
  reason: z.string(),
});
export type RequiredDocument = z.infer<typeof requiredDocumentSchema>;

export const softPullResponseSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('approved'), offer: offerSchema }),
  z.object({ status: z.literal('rejected'), reason: z.enum(REJECTION_REASONS) }),
  z.object({
    status: z.literal('need-more-documents'),
    documents: z.array(requiredDocumentSchema).min(1),
  }),
]);
export type SoftPullResponse = z.infer<typeof softPullResponseSchema>;

// Document review: after a Need More Documents soft pull, the borrower's documents are
// submitted and Figure makes its final call (approved or rejected — never more documents).

export const submittedAttachmentSchema = z.object({
  filename: z.string(),
  content_type: z.string(),
  size: z.number().int().nonnegative(),
});
export type SubmittedAttachment = z.infer<typeof submittedAttachmentSchema>;

export const documentReviewRequestSchema = softPullRequestSchema.extend({
  documents: z.array(requiredDocumentSchema).min(1),
  attachments: z.array(submittedAttachmentSchema).min(1),
});
export type DocumentReviewRequest = z.infer<typeof documentReviewRequestSchema>;

export const documentReviewResponseSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('approved'), offer: offerSchema }),
  z.object({ status: z.literal('rejected'), reason: z.enum(REJECTION_REASONS) }),
]);
export type DocumentReviewResponse = z.infer<typeof documentReviewResponseSchema>;
