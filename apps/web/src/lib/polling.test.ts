import { describe, expect, it } from 'vitest';
import { POLL_TIMEOUT_MS, shouldPoll } from './polling.ts';

describe('shouldPoll', () => {
  it('polls while intake is still working on the Lead', () => {
    expect(shouldPoll('submitted', 0)).toBe(true);
    expect(shouldPoll('processing', 10_000)).toBe(true);
  });

  it('stops once the Lead has settled', () => {
    for (const status of [
      'approved',
      'rejected',
      'need_more_documents',
      'chase_sent',
      'failed',
    ] as const) {
      expect(shouldPoll(status, 0)).toBe(false);
    }
  });

  it('gives up after the polling window', () => {
    expect(shouldPoll('processing', POLL_TIMEOUT_MS)).toBe(false);
  });
});
