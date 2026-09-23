import type { LeadResult } from '@heloc/contracts';
import { describe, expect, it } from 'vitest';
import {
  AWAITING_REPLY_POLL,
  IN_FLIGHT_POLL,
  NOTICE_POLL,
  pollPlan,
  pollPolicy,
  REVIEW_POLL,
} from './polling.ts';

type Polled = Pick<LeadResult, 'status' | 'notice'>;
const notice = (status: 'pending' | 'sent' | 'failed') => ({ status, sent_at: null });

describe('pollPolicy', () => {
  it('polls quickly while intake is still working on the Lead', () => {
    expect(pollPolicy({ status: 'submitted' })).toBe(IN_FLIGHT_POLL);
    expect(pollPolicy({ status: 'processing' })).toBe(IN_FLIGHT_POLL);
    expect(IN_FLIGHT_POLL.intervalMs).toBe(2_000);
  });

  it('polls slowly while waiting for the Chase Reply', () => {
    expect(pollPolicy({ status: 'need_more_documents' })).toBe(AWAITING_REPLY_POLL);
    expect(pollPolicy({ status: 'chase_sent' })).toBe(AWAITING_REPLY_POLL);
    expect(AWAITING_REPLY_POLL.intervalMs).toBe(10_000);
  });

  it('polls through the Document Review', () => {
    expect(pollPolicy({ status: 'documents_received' })).toBe(REVIEW_POLL);
  });

  it('keeps polling a decision only until its Outcome Notice is sent', () => {
    expect(pollPolicy({ status: 'approved', notice: notice('pending') })).toBe(NOTICE_POLL);
    expect(pollPolicy({ status: 'rejected', notice: notice('pending') })).toBe(NOTICE_POLL);
    expect(pollPolicy({ status: 'approved', notice: notice('sent') })).toBeUndefined();
    expect(pollPolicy({ status: 'rejected', notice: notice('failed') })).toBeUndefined();
    expect(pollPolicy({ status: 'approved' })).toBeUndefined();
  });

  it('stops for a failed Lead (Replay is up to the Borrower)', () => {
    expect(pollPolicy({ status: 'failed' })).toBeUndefined();
  });
});

describe('pollPlan', () => {
  it('schedules the next fetch at the policy interval', () => {
    expect(pollPlan({ status: 'processing' }, 0)).toEqual({ action: 'poll', delayMs: 2_000 });
    expect(pollPlan({ status: 'chase_sent' }, 60_000)).toEqual({
      action: 'poll',
      delayMs: 10_000,
    });
    expect(pollPlan({ status: 'documents_received' }, 0)).toEqual({
      action: 'poll',
      delayMs: 3_000,
    });
  });

  it('stops without stalling once the Lead has settled', () => {
    const settled: Polled[] = [
      { status: 'approved' },
      { status: 'rejected' },
      { status: 'failed' },
      { status: 'approved', notice: notice('sent') },
    ];
    for (const lead of settled)
      expect(pollPlan(lead, 0)).toEqual({ action: 'stop', stalled: false });
  });

  it('calls intake stalled after its window', () => {
    expect(pollPlan({ status: 'processing' }, IN_FLIGHT_POLL.timeoutMs)).toEqual({
      action: 'stop',
      stalled: true,
    });
    expect(pollPlan({ status: 'documents_received' }, REVIEW_POLL.timeoutMs)).toEqual({
      action: 'stop',
      stalled: true,
    });
  });

  it('stops quietly when the Borrower has not replied within the window', () => {
    expect(pollPlan({ status: 'chase_sent' }, AWAITING_REPLY_POLL.timeoutMs - 1).action).toBe(
      'poll',
    );
    expect(pollPlan({ status: 'chase_sent' }, AWAITING_REPLY_POLL.timeoutMs)).toEqual({
      action: 'stop',
      stalled: false,
    });
    expect(
      pollPlan({ status: 'approved', notice: notice('pending') }, NOTICE_POLL.timeoutMs),
    ).toEqual({ action: 'stop', stalled: false });
  });
});
