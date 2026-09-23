import { describe, expect, it } from 'vitest';
import { HELOC_LIMITS } from '@heloc/contracts';
import {
  availableEquity,
  calculateOffer,
  evaluate,
  force,
  MAX_COMBINED_LTV,
  MAX_LINE,
  MIN_LINE,
  monthlyPayment,
  reviewDocuments,
} from './soft-pull-policy.ts';
import type { SoftPull } from './soft-pull.ts';

const now = new Date('2026-09-23T00:00:00Z');
const pull = (overrides: Partial<SoftPull> = {}): SoftPull => ({
  leadId: '00000000-0000-4000-8000-000000000001',
  propertyState: 'CA',
  homeValue: 800_000,
  mortgageBalance: 350_000,
  creditBand: '700-739',
  incomeBand: '150k-200k',
  ...overrides,
});

describe('evaluate', () => {
  it.each([
    ['<580', 'rejected'],
    ['580-619', 'rejected'],
    ['620-659', 'need-more-documents'],
    ['660-699', 'need-more-documents'],
    ['700-739', 'need-more-documents'],
    ['740-779', 'approved'],
    ['780+', 'approved'],
  ] as const)('credit %s → %s', (creditBand, status) => {
    expect(evaluate(pull({ creditBand }), now).status).toBe(status);
  });

  it('rejects for insufficient equity before looking at credit', () => {
    const outcome = evaluate(pull({ creditBand: '780+', mortgageBalance: 670_000 }), now);
    expect(outcome).toEqual({ status: 'rejected', reason: 'insufficient_home_equity' });
  });

  it('gives the rejection reason for low credit', () => {
    expect(evaluate(pull({ creditBand: '<580' }), now)).toEqual({
      status: 'rejected',
      reason: 'credit_below_minimum',
    });
  });

  it('asks only for income verification in the spec example', () => {
    expect(evaluate(pull(), now)).toEqual({
      status: 'need-more-documents',
      documents: [{ type: 'income_verification', reason: 'Income requires verification' }],
    });
  });

  it('also asks for a mortgage statement when the loan-to-value is high', () => {
    const outcome = evaluate(pull({ mortgageBalance: 600_000, homeValue: 900_000 }), now);
    expect(
      outcome.status === 'need-more-documents' && outcome.documents.map((d) => d.type),
    ).toEqual(['income_verification', 'mortgage_statement']);
  });

  it('works for a paid-off home', () => {
    expect(evaluate(pull({ mortgageBalance: 0, creditBand: '780+' }), now).status).toBe('approved');
  });
});

describe('calculateOffer', () => {
  it('is capped by equity, income and the product maximum, in $5k steps', () => {
    // equity 330k, income cap 250k → 250k
    expect(calculateOffer(pull({ creditBand: '780+' }), now).amount).toBe(250_000);
    // equity 30k (0.85 × 400k − 310k) → 30k
    expect(calculateOffer(pull({ homeValue: 400_000, mortgageBalance: 310_000 }), now).amount).toBe(
      30_000,
    );
    // rich borrower, big house → product max
    expect(
      calculateOffer(pull({ homeValue: 3_000_000, mortgageBalance: 0, incomeBand: '300k+' }), now)
        .amount,
    ).toBe(400_000);
  });

  it('prices by credit band and expires in 30 days', () => {
    const offer = calculateOffer(pull({ creditBand: '780+' }), now);
    expect(offer).toMatchObject({
      lender: 'Figure mock',
      aprMin: 7.5,
      aprMax: 9.5,
      termMonths: 120,
    });
    expect(offer.expiresAt.toISOString()).toBe('2026-10-23T00:00:00.000Z');
  });

  it('never goes below the minimum line', () => {
    expect(calculateOffer(pull({ mortgageBalance: 800_000 }), now).amount).toBe(MIN_LINE);
  });
});

describe('monthlyPayment', () => {
  it('matches the spec example: $150k at 7.5% over 120 months ≈ $1,780', () => {
    expect(Math.round(monthlyPayment(150_000, 7.5, 120))).toBe(1_781);
  });
});

describe('availableEquity', () => {
  it('is 85% of value minus the mortgage', () => {
    expect(availableEquity({ homeValue: 800_000, mortgageBalance: 350_000 })).toBe(330_000);
  });
});

describe('force', () => {
  it('returns the natural outcome when it already matches', () => {
    expect(force(pull(), 'need-more-documents', now)).toEqual(evaluate(pull(), now));
  });

  it('builds a coherent offer for a forced approval', () => {
    const outcome = force(pull({ creditBand: '<580' }), 'approved', now);
    expect(outcome.status === 'approved' && outcome.offer.amount).toBeGreaterThanOrEqual(MIN_LINE);
  });

  it('can force a rejection or a documents request', () => {
    expect(force(pull({ creditBand: '780+' }), 'rejected', now).status).toBe('rejected');
    expect(force(pull({ creditBand: '780+' }), 'need-more-documents', now).status).toBe(
      'need-more-documents',
    );
  });
});

describe('reviewDocuments', () => {
  it('approves a need-more-documents profile once documents are in', () => {
    const outcome = reviewDocuments(pull({ creditBand: '700-739' }), now);
    expect(outcome.status).toBe('approved');
    expect(outcome.status === 'approved' && outcome.offer.amount).toBe(250_000);
  });

  it('still enforces the hard limits', () => {
    expect(reviewDocuments(pull({ creditBand: '<580' }), now)).toEqual({
      status: 'rejected',
      reason: 'credit_below_minimum',
    });
    expect(reviewDocuments(pull({ mortgageBalance: 670_000 }), now)).toEqual({
      status: 'rejected',
      reason: 'insufficient_home_equity',
    });
  });

  it('honours a forced outcome', () => {
    expect(reviewDocuments(pull(), now, 'rejected').status).toBe('rejected');
    expect(reviewDocuments(pull({ creditBand: '<580' }), now, 'approved').status).toBe('approved');
  });
});

describe('published limits', () => {
  it('match the product limits in the contracts', () => {
    expect({ maxCombinedLtv: MAX_COMBINED_LTV, minLine: MIN_LINE, maxLine: MAX_LINE }).toEqual(
      HELOC_LIMITS,
    );
  });
});
