import {
  CREDIT_BANDS,
  type CreditBand,
  type IncomeBand,
  type Offer,
  type Outcome,
  type OutcomeStatus,
  type RequiredDocument,
  type ReviewOutcome,
  type ReviewOutcomeStatus,
  type SoftPull,
} from './soft-pull.ts';

/** Lenders cap a HELOC so first mortgage + line stays within 85% of the home's value. */
export const MAX_COMBINED_LTV = 0.85;
/** Smallest line worth offering. */
export const MIN_LINE = 25_000;
export const MAX_LINE = 400_000;
const LENDER = 'Figure mock';
const TERM_MONTHS = 120;
const OFFER_VALID_DAYS = 30;

const rank = (band: CreditBand) => CREDIT_BANDS.indexOf(band);

/** House value × 85% − mortgage balance: the most a lender could extend. */
export function availableEquity(pull: Pick<SoftPull, 'homeValue' | 'mortgageBalance'>): number {
  return pull.homeValue * MAX_COMBINED_LTV - pull.mortgageBalance;
}

/**
 * Deterministic underwriting rules, so demos are repeatable:
 *   1. available equity < $25k           → rejected (insufficient_home_equity)
 *   2. credit below 620                  → rejected (credit_below_minimum)
 *   3. credit 740+                       → approved with an Offer
 *   4. otherwise (620–739)               → need-more-documents
 */
export function evaluate(pull: SoftPull, now: Date): Outcome {
  if (availableEquity(pull) < MIN_LINE) {
    return { status: 'rejected', reason: 'insufficient_home_equity' };
  }
  if (rank(pull.creditBand) < rank('620-659')) {
    return { status: 'rejected', reason: 'credit_below_minimum' };
  }
  if (rank(pull.creditBand) >= rank('740-779')) {
    return { status: 'approved', offer: calculateOffer(pull, now) };
  }
  return { status: 'need-more-documents', documents: requiredDocuments(pull) };
}

/**
 * A Forced Outcome replaces the rules' verdict but keeps the details coherent:
 * a forced approval still gets a computed Offer (at least the minimum line), a forced
 * rejection reuses the rules' reason when there is one.
 */
export function force(pull: SoftPull, status: OutcomeStatus, now: Date): Outcome {
  const natural = evaluate(pull, now);
  if (natural.status === status) return natural;
  switch (status) {
    case 'approved':
      return { status, offer: calculateOffer(pull, now) };
    case 'rejected':
      return { status, reason: 'insufficient_home_equity' };
    case 'need-more-documents':
      return { status, documents: requiredDocuments(pull) };
  }
}

/**
 * Document Review: the submitted documents satisfy the verification request, so only the
 * hard limits remain — equity and minimum credit. Everything else is approved.
 */
export function reviewDocuments(
  pull: SoftPull,
  now: Date,
  forced?: ReviewOutcomeStatus,
): ReviewOutcome {
  const natural = evaluate(pull, now);
  const verdict: ReviewOutcome =
    natural.status === 'rejected'
      ? natural
      : { status: 'approved', offer: calculateOffer(pull, now) };
  if (!forced || forced === verdict.status) return verdict;
  return forced === 'approved'
    ? { status: 'approved', offer: calculateOffer(pull, now) }
    : { status: 'rejected', reason: 'insufficient_home_equity' };
}

function requiredDocuments(pull: SoftPull): RequiredDocument[] {
  const documents: RequiredDocument[] = [
    { type: 'income_verification', reason: 'Income requires verification' },
  ];
  if (pull.mortgageBalance / pull.homeValue > 0.6) {
    documents.push({
      type: 'mortgage_statement',
      reason: 'Current mortgage balance must be confirmed',
    });
  }
  return documents;
}

/** Annual income the line may not exceed, by band. */
const INCOME_CAP: Record<IncomeBand, number> = {
  '<50k': 50_000,
  '50k-100k': 100_000,
  '100k-150k': 150_000,
  '150k-200k': 250_000,
  '200k-300k': 350_000,
  '300k+': MAX_LINE,
};

const APR_BY_CREDIT: Partial<Record<CreditBand, [number, number]>> = {
  '780+': [7.5, 9.5],
  '740-779': [8.25, 10.25],
};
const DEFAULT_APR: [number, number] = [9.5, 11.5];

export function calculateOffer(pull: SoftPull, now: Date): Offer {
  const cap = Math.min(availableEquity(pull), INCOME_CAP[pull.incomeBand], MAX_LINE);
  // Round down to a clean $5k step, never below the minimum line.
  const amount = Math.max(MIN_LINE, Math.floor(cap / 5_000) * 5_000);
  const [aprMin, aprMax] = APR_BY_CREDIT[pull.creditBand] ?? DEFAULT_APR;
  return {
    lender: LENDER,
    amount,
    aprMin,
    aprMax,
    termMonths: TERM_MONTHS,
    estimatedMonthlyPayment: Math.round(monthlyPayment(amount, aprMin, TERM_MONTHS)),
    expiresAt: new Date(now.getTime() + OFFER_VALID_DAYS * 24 * 60 * 60 * 1000),
  };
}

/** Fully amortizing payment at the lowest APR. */
export function monthlyPayment(principal: number, aprPercent: number, months: number): number {
  const r = aprPercent / 100 / 12;
  return (principal * r) / (1 - (1 + r) ** -months);
}
