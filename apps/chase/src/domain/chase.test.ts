import { describe, expect, it } from 'vitest';
import { deliveryKey, documentRequest, firstName } from './chase.ts';

describe('documentRequest', () => {
  it('uses the borrower-facing label', () => {
    expect(
      documentRequest({ type: 'income_verification', reason: 'Income requires verification' }),
    ).toEqual({
      label: 'Proof of income',
      reason: 'Income requires verification',
    });
  });

  it('humanizes an unknown document type', () => {
    expect(documentRequest({ type: 'tax_return', reason: 'x' }).label).toBe('Tax return');
  });
});

describe('deliveryKey', () => {
  it('is stable per Chase', () => {
    expect(deliveryKey({ chaseId: 'abc' })).toBe('chase:abc');
  });
});

describe('firstName', () => {
  it.each([
    ['John Doe', 'John'],
    ['  Mary   Ann Lee ', 'Mary'],
    ['Cher', 'Cher'],
  ])('%s → %s', (name, expected) => {
    expect(firstName({ name, email: 'x@y.z' })).toBe(expected);
  });
});
