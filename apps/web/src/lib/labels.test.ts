import {
  CREDIT_BANDS,
  DOCUMENT_TYPES,
  INCOME_BANDS,
  LEAD_EVENT_TYPES,
  PURPOSES,
  US_STATES,
} from '@heloc/contracts';
import { describe, expect, it } from 'vitest';
import {
  CREDIT_BAND_LABELS,
  documentLabel,
  EVENT_LABELS,
  eventDetail,
  INCOME_BAND_LABELS,
  PURPOSE_LABELS,
  rejectionExplanation,
  STATE_NAMES,
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

  it('falls back to a generic message', () => {
    expect(rejectionExplanation('something_new').title).toBe(
      'We could not prequalify you right now',
    );
    expect(rejectionExplanation(undefined).title).toBe('We could not prequalify you right now');
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

  it('has nothing to add for plain milestones or odd payloads', () => {
    expect(eventDetail(event('lead.created'))).toBeUndefined();
    expect(eventDetail(event('figure.approved', { amount: 'lots' }))).toBeUndefined();
    expect(eventDetail(event('figure.rejected'))).toBeUndefined();
  });
});
