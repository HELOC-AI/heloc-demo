import type { LeadResult } from '@heloc/contracts';

/** How often and for how long the result page re-fetches a Lead in a given situation. */
export interface PollPolicy {
  intervalMs: number;
  /** Measured from when the page first saw the Lead in this status. */
  timeoutMs: number;
  /**
   * When the window runs out: `true` → intake should have finished by now, so tell the
   * Borrower it's taking longer than usual; `false` → just stop checking automatically
   * (we're waiting on the Borrower, which can take hours).
   */
  stallsAfterTimeout: boolean;
}

/** Intake is working on the Lead; Figure usually answers within seconds. */
export const IN_FLIGHT_POLL: PollPolicy = {
  intervalMs: 2_000,
  timeoutMs: 30_000,
  stallsAfterTimeout: true,
};

/** Waiting for the Borrower's Chase Reply: check slowly, and not forever. */
export const AWAITING_REPLY_POLL: PollPolicy = {
  intervalMs: 10_000,
  timeoutMs: 15 * 60_000,
  stallsAfterTimeout: false,
};

/** Figure's Document Review, then the Outcome Notice. */
export const REVIEW_POLL: PollPolicy = {
  intervalMs: 3_000,
  timeoutMs: 2 * 60_000,
  stallsAfterTimeout: true,
};

/** The decision is in; only the Outcome Notice email is still on its way. */
export const NOTICE_POLL: PollPolicy = {
  intervalMs: 5_000,
  timeoutMs: 60_000,
  stallsAfterTimeout: false,
};

/** Which polling policy applies to a Lead, or undefined when nothing more is expected. */
export function pollPolicy(lead: Pick<LeadResult, 'status' | 'notice'>): PollPolicy | undefined {
  switch (lead.status) {
    case 'submitted':
    case 'processing':
      return IN_FLIGHT_POLL;
    case 'need_more_documents':
    case 'chase_sent':
      return AWAITING_REPLY_POLL;
    case 'documents_received':
      return REVIEW_POLL;
    case 'approved':
    case 'rejected':
      return lead.notice?.status === 'pending' ? NOTICE_POLL : undefined;
    case 'failed':
      return undefined;
  }
}

export type PollPlan =
  | { action: 'poll'; delayMs: number }
  /** `stalled`: the page stopped waiting on intake before it finished. */
  | { action: 'stop'; stalled: boolean };

/**
 * Whether the result page should fetch the Lead again, and when. `elapsedMs` counts from
 * when the page first saw the Lead in its current status, so each stage gets its own window.
 */
export function pollPlan(lead: Pick<LeadResult, 'status' | 'notice'>, elapsedMs: number): PollPlan {
  const policy = pollPolicy(lead);
  if (!policy) return { action: 'stop', stalled: false };
  if (elapsedMs >= policy.timeoutMs) return { action: 'stop', stalled: policy.stallsAfterTimeout };
  return { action: 'poll', delayMs: policy.intervalMs };
}
