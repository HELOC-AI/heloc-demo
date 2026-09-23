'use client';

import type { LeadResult } from '@heloc/contracts';
import { useCallback, useEffect, useState } from 'react';
import { leadApi } from '@/lib/api';
import { isInFlight, POLL_INTERVAL_MS, shouldPoll } from '@/lib/polling';

export type LeadState =
  | { phase: 'loading' }
  /** `stalled`: still in flight after the polling window; the Borrower can check again. */
  | { phase: 'ready'; lead: LeadResult; stalled: boolean }
  | { phase: 'not_found' }
  | { phase: 'error'; message: string };

/**
 * Loads a Lead and keeps polling while intake is still working on it
 * (every ~2s, for up to ~30s).
 */
export function useLead(leadId: string) {
  const [state, setState] = useState<LeadState>({ phase: 'loading' });
  // Bumped to restart loading and polling (Check again, or after a Replay).
  const [generation, setGeneration] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const startedAt = Date.now();

    async function load() {
      const result = await leadApi.getLead(leadId);
      if (cancelled) return;
      if (result.kind === 'lead') {
        const { status } = result.lead;
        const poll = shouldPoll(status, Date.now() - startedAt);
        setState({ phase: 'ready', lead: result.lead, stalled: isInFlight(status) && !poll });
        if (poll) timer = setTimeout(load, POLL_INTERVAL_MS);
      } else if (result.kind === 'not_found') {
        setState({ phase: 'not_found' });
      } else {
        setState({
          phase: 'error',
          message: result.kind === 'error' ? result.message : 'Please try again in a moment.',
        });
      }
    }

    void load();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [leadId, generation]);

  const reload = useCallback(() => {
    setState({ phase: 'loading' });
    setGeneration((n) => n + 1);
  }, []);

  /** Shows a LeadResult obtained elsewhere (Replay), polling again if it is still in flight. */
  const show = useCallback((lead: LeadResult) => {
    setState({ phase: 'ready', lead, stalled: false });
    if (isInFlight(lead.status)) setGeneration((n) => n + 1);
  }, []);

  return { state, reload, show };
}
