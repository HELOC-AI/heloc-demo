import { z } from 'zod';
import { CREDIT_BANDS, INCOME_BANDS, US_STATES } from './common.ts';

export const MOCK_OUTCOMES = ['approved', 'rejected', 'need-more-documents'] as const;
export type MockOutcome = (typeof MOCK_OUTCOMES)[number];

/** Injected failures, used to demo failure modes and replay. */
export const MOCK_FAULTS = ['timeout', 'error'] as const;
export type MockFault = (typeof MOCK_FAULTS)[number];

export const DOCUMENT_TYPES = [
  'income_verification',
  'employment_verification',
  'mortgage_statement',
  'property_valuation',
  'identity_verification',
] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];

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
  z.object({ status: z.literal('rejected'), reason: z.string() }),
  z.object({
    status: z.literal('need-more-documents'),
    documents: z.array(requiredDocumentSchema).min(1),
  }),
]);
export type SoftPullResponse = z.infer<typeof softPullResponseSchema>;
