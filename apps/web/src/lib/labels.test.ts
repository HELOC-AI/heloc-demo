import {
  CREDIT_BANDS,
  DOCUMENT_TYPES,
  INCOME_BANDS,
  LEAD_EVENT_TYPES,
  LEAD_STATUSES,
  LEAD_STEPS,
  PURPOSES,
  REJECTION_REASONS,
  US_STATES,
} from '@heloc/contracts';
import { describe, expect, it } from 'vitest';
import {
  CREDIT_BAND_LABELS,
  documentLabel,
  EVENT_LABELS,
  eventDetail,
  failureCopy,
  INCOME_BAND_LABELS,
  isProblemEvent,
  isRejectionReason,
  PURPOSE_LABELS,
  rejectionExplanation,
  STATE_NAMES,
  STATUS_LABELS,
} from './labels.ts';

const event = (type: (typeof LEAD_EVENT_TYPES)[number], payload: Record<string, unknown> = {}) => ({
  type,
  payload,
  created_at: '2026-09-23T10:00:00.000Z',
});

describe('labels', () => {
  it('labels every contract value', () => {
    for (const code of US_STATES) expect(STATE_NAMES[code]).toBeTruthy();
    for (const band of CREDIT_BANDS) expect(CREDIT_BAND_LABELS[band]).toBeTruthy();
    for (const band of INCOME_BANDS) expect(INCOME_BAND_LABELS[band]).toBeTruthy();
    for (const purpose of PURPOSES) expect(PURPOSE_LABELS[purpose]).toBeTruthy();
    for (const type of LEAD_EVENT_TYPES) expect(EVENT_LABELS[type]).toBeTruthy();
    for (const status of LEAD_STATUSES) expect(STATUS_LABELS[status]).toBeTruthy();
  });

  it('uses borrower-facing names for Missing Documents', () => {
    expect(DOCUMENT_TYPES.map(documentLabel)).toEqual([
      'Proof of income',
      'Proof of employment',
      'Your most recent mortgage statement',
      'A recent home appraisal or valuation',
      'A government-issued photo ID',
    ]);
  });

  it('humanizes document types it does not know yet', () => {
    expect(documentLabel('tax_return')).toBe('Tax return');
  });

  it('uses the demo event labels', () => {
    expect(EVENT_LABELS['lead.created']).toBe('Application received');
    expect(EVENT_LABELS['figure.requested']).toBe('Soft credit check requested');
    expect(EVENT_LABELS['figure.need_more_documents']).toBe('Documents requested');
    expect(EVENT_LABELS['email.sent']).toBe('Email sent');
    expect(EVENT_LABELS['lead.replayed']).toBe('Replayed');
    expect(EVENT_LABELS['documents.received']).toBe('Documents received');
    expect(EVENT_LABELS['documents.rejected']).toBe('Reply not accepted');
    expect(EVENT_LABELS['figure.review_requested']).toBe('Documents sent to Figure for review');
    expect(EVENT_LABELS['figure.review_approved']).toBe('Approved after review');
    expect(EVENT_LABELS['figure.review_rejected']).toBe('Declined after review');
    expect(EVENT_LABELS['notice.sent']).toBe('Result email sent');
    expect(EVENT_LABELS['notice.failed']).toBe('Result email failed');
  });
});

describe('rejectionExplanation', () => {
  it('explains insufficient home equity', () => {
    const { title, body } = rejectionExplanation('insufficient_home_equity');
    expect(title).toMatch(/equity/i);
    expect(body).toContain('$25,000');
  });

  it('explains a credit range below the minimum', () => {
    expect(rejectionExplanation('credit_below_minimum').title).toMatch(/credit/i);
  });

  it('explains every published rejection reason', () => {
    for (const reason of REJECTION_REASONS) {
      expect(rejectionExplanation(reason).title).not.toBe('We could not prequalify you right now');
    }
  });

  it('falls back to a generic message when there is no reason', () => {
    expect(rejectionExplanation(undefined).title).toBe('We could not prequalify you right now');
  });

  it('recognizes reason codes from untyped payloads', () => {
    expect(isRejectionReason('credit_below_minimum')).toBe(true);
    expect(isRejectionReason('something_new')).toBe(false);
    expect(isRejectionReason(undefined)).toBe(false);
  });
});

describe('failureCopy', () => {
  it('explains each step a Lead can fail at', () => {
    expect(LEAD_STEPS.map((step) => failureCopy(step).title)).toEqual([
      "We couldn't complete your credit check",
      "We couldn't send the documents request email",
      "We couldn't finish reviewing your documents",
      "Your result is ready but we couldn't email it",
    ]);
  });

  it('keeps the generic copy for Leads that do not say where they failed', () => {
    expect(failureCopy(undefined).title).toBe('We hit a snag checking your options');
  });
});

describe('eventDetail', () => {
  it('summarizes decisions and failures from the payload', () => {
    expect(eventDetail(event('figure.approved', { amount: 250_000, apr_min: 7.5 }))).toBe(
      'Line up to $250,000',
    );
    expect(eventDetail(event('figure.rejected', { reason: 'credit_below_minimum' }))).toBe(
      'Credit range below our minimum',
    );
    expect(
      eventDetail(
        event('figure.need_more_documents', {
          documents: ['income_verification', 'mortgage_statement'],
        }),
      ),
    ).toBe('Proof of income, Your most recent mortgage statement');
    expect(eventDetail(event('lead.failed', { step: 'prequalify', reason: 'timeout' }))).toBe(
      'timeout',
    );
    expect(eventDetail(event('lead.replayed', { from_status: 'failed' }))).toBe(
      'Resumed from “failed”',
    );
  });

  it('summarizes the Chase Reply and Document Review', () => {
    const attachments = [
      { filename: 'paystub.pdf', content_type: 'application/pdf', size: 48_000 },
      { filename: 'w2.jpg', content_type: 'image/jpeg', size: 900_000 },
    ];
    expect(eventDetail(event('documents.received', { attachments }))).toBe(
      '2 attachments: paystub.pdf, w2.jpg',
    );
    expect(eventDetail(event('figure.review_requested', { attachments: 1 }))).toBe('1 attachment');
    expect(eventDetail(event('documents.rejected', { reason: 'sender_mismatch' }))).toBe(
      'Sender mismatch',
    );
    expect(
      eventDetail(event('documents.rejected', { reason: 'The reply had no attachments' })),
    ).toBe('The reply had no attachments');
    expect(eventDetail(event('figure.review_approved', { amount: 120_000 }))).toBe(
      'Line up to $120,000',
    );
    expect(
      eventDetail(event('figure.review_rejected', { reason: 'insufficient_home_equity' })),
    ).toBe('Not enough available home equity');
    expect(eventDetail(event('notice.failed', { reason: 'email service unavailable' }))).toBe(
      'email service unavailable',
    );
  });

  it('has nothing to add for plain milestones or odd payloads', () => {
    expect(eventDetail(event('lead.created'))).toBeUndefined();
    expect(eventDetail(event('notice.sent'))).toBeUndefined();
    expect(eventDetail(event('figure.approved', { amount: 'lots' }))).toBeUndefined();
    expect(eventDetail(event('figure.rejected'))).toBeUndefined();
    expect(eventDetail(event('documents.received', { attachments: [] }))).toBeUndefined();
    expect(eventDetail(event('documents.rejected'))).toBeUndefined();
  });
});

describe('isProblemEvent', () => {
  it('flags failures and refused replies', () => {
    const flagged = LEAD_EVENT_TYPES.filter(isProblemEvent);
    expect(flagged).toEqual(['lead.failed', 'email.failed', 'documents.rejected', 'notice.failed']);
  });
});
