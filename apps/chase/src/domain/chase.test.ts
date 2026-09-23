import { describe, expect, it } from 'vitest';
import { parseChaseReplyAddress } from '@heloc/contracts';
import {
  deliveryKey,
  documentRequest,
  firstName,
  noticeDeliveryKey,
  replyAddressFor,
} from './chase.ts';

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

describe('replyAddressFor', () => {
  const chaseId = '22222222-2222-4222-8222-222222222222';

  it('subaddresses the base Reply Address with the chase id', () => {
    expect(replyAddressFor('reply@linkerclaw.ai', chaseId)).toBe(`reply+${chaseId}@linkerclaw.ai`);
  });

  it('round-trips through the parser Lead Intake uses', () => {
    expect(parseChaseReplyAddress(replyAddressFor('reply@linkerclaw.ai', chaseId))).toBe(chaseId);
  });
});

describe('noticeDeliveryKey', () => {
  it('differs from the chase key namespace', () => {
    expect(noticeDeliveryKey({ noticeId: 'abc' })).toBe('notice:abc');
  });
});
