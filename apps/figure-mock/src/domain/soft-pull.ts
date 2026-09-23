/**
 * Prequalification domain (see ../../CONTEXT.md). Figure's own language: Soft Pull,
 * Outcome, Offer, Required Document. Pure TypeScript — no framework imports.
 */

/** Ordered lowest → highest; policy compares bands by position. */
export const CREDIT_BANDS = [
  '<580',
  '580-619',
  '620-659',
  '660-699',
  '700-739',
  '740-779',
  '780+',
] as const;
export type CreditBand = (typeof CREDIT_BANDS)[number];

export const INCOME_BANDS = [
  '<50k',
  '50k-100k',
  '100k-150k',
  '150k-200k',
  '200k-300k',
  '300k+',
] as const;
export type IncomeBand = (typeof INCOME_BANDS)[number];

export type DocumentType =
  | 'income_verification'
  | 'employment_verification'
  | 'mortgage_statement'
  | 'property_valuation'
  | 'identity_verification';

export interface SoftPull {
  leadId: string;
  propertyState: string;
  homeValue: number;
  mortgageBalance: number;
  creditBand: CreditBand;
  incomeBand: IncomeBand;
}

export interface Offer {
  lender: string;
  amount: number;
  aprMin: number;
  aprMax: number;
  termMonths: number;
  estimatedMonthlyPayment: number;
  expiresAt: Date;
}

export interface RequiredDocument {
  type: DocumentType;
  reason: string;
}

export type RejectionReason = 'insufficient_home_equity' | 'credit_below_minimum';

export type Outcome =
  | { status: 'approved'; offer: Offer }
  | { status: 'rejected'; reason: RejectionReason }
  | { status: 'need-more-documents'; documents: RequiredDocument[] };

export type OutcomeStatus = Outcome['status'];
