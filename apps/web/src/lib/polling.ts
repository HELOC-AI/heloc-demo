import type { LeadStatus } from '@heloc/contracts';

export const POLL_INTERVAL_MS = 2_000;
export const POLL_TIMEOUT_MS = 30_000;

/** A Lead in these statuses is still being worked on by intake. */
const IN_FLIGHT: ReadonlySet<LeadStatus> = new Set(['submitted', 'processing']);

export function isInFlight(status: LeadStatus): boolean {
  return IN_FLIGHT.has(status);
}

/**
 * Whether the result page should fetch the Lead again: only while intake is still
 * working on it, and only until the page has waited long enough to call it stuck.
 */
export function shouldPoll(status: LeadStatus, elapsedMs: number): boolean {
  return isInFlight(status) && elapsedMs < POLL_TIMEOUT_MS;
}
