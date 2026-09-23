'use client';

import type { LeadResult, LeadStatus } from '@heloc/contracts';
import { useCallback, useEffect, useState } from 'react';
import { leadApi } from '@/lib/api';
import { pollPlan, pollPolicy } from '@/lib/polling';

export interface ReadyLead {
  phase: 'ready';
  lead: LeadResult;
  /** Intake should have finished by now but hasn't; the Borrower can check again. */
  stalled: boolean;
  /** The page is re-fetching the Lead on its own (e.g. waiting for the Chase Reply). */
  watching: boolean;
  /** A "Check again" is in progress. */
  checking: boolean;
  /** The last background or manual check failed; the Lead shown may be out of date. */
  checkFailed: boolean;
  /** When the Lead shown was fetched (epoch ms). */
  checkedAt: number;
}

export type LeadState =
  { phase: 'loading' } | ReadyLead | { phase: 'not_found' } | { phase: 'error'; message: string };

/**
 * Loads a Lead and keeps polling while something is still expected to happen: quickly
 * while intake works on it, slowly while we wait for the Borrower's Chase Reply
 * (see `pollPlan` for the windows).
 */
export function useLead(leadId: string) {
  const [state, setState] = useState<LeadState>({ phase: 'loading' });
  // Bumped to restart loading and polling (Check again, or after a Replay).
  const [generation, setGeneration] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let lastLead: LeadResult | undefined;
    // Each status gets its own polling window, counted from when we first saw it.
    let status: LeadStatus | undefined;
    let statusSince = Date.now();

    function schedule(lead: LeadResult) {
      const plan = pollPlan(lead, Date.now() - statusSince);
      if (plan.action === 'poll') timer = setTimeout(load, plan.delayMs);
      return plan;
    }

    async function load() {
      const result = await leadApi.getLead(leadId);
      if (cancelled) return;

      if (result.kind === 'lead') {
        const { lead } = result;
        if (lead.status !== status) {
          status = lead.status;
          statusSince = Date.now();
        }
        lastLead = lead;
        const plan = schedule(lead);
        setState({
          phase: 'ready',
          lead,
          stalled: plan.action === 'stop' && plan.stalled,
          watching: plan.action === 'poll',
          checking: false,
          checkFailed: false,
          checkedAt: Date.now(),
        });
        return;
      }
      if (result.kind === 'not_found') {
        setState({ phase: 'not_found' });
        return;
      }

      const message = result.kind === 'error' ? result.message : 'Please try again in a moment.';
      if (!lastLead) {
        // Nothing shown yet, or a Check again of a Lead from an earlier generation.
        setState((prev) =>
          prev.phase === 'ready'
            ? { ...prev, checking: false, checkFailed: true, watching: false }
            : { phase: 'error', message },
        );
        return;
      }
      // A blip while polling: keep showing the Lead we have and try again on schedule.
      const plan = schedule(lastLead);
      setState((prev) =>
        prev.phase === 'ready'
          ? { ...prev, checking: false, checkFailed: true, watching: plan.action === 'poll' }
          : prev,
      );
    }

    void load();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [leadId, generation]);

  /** Starts over with the loading skeleton (after a load error). */
  const reload = useCallback(() => {
    setState({ phase: 'loading' });
    setGeneration((n) => n + 1);
  }, []);

  /** Fetches the Lead again now, keeping the current one on screen meanwhile. */
  const refresh = useCallback(() => {
    setState((prev) =>
      prev.phase === 'ready' ? { ...prev, checking: true } : { phase: 'loading' },
    );
    setGeneration((n) => n + 1);
  }, []);

  /** Shows a LeadResult obtained elsewhere (Replay), polling again if more is expected. */
  const show = useCallback((lead: LeadResult) => {
    setState({
      phase: 'ready',
      lead,
      stalled: false,
      watching: false,
      checking: false,
      checkFailed: false,
      checkedAt: Date.now(),
    });
    if (pollPolicy(lead)) setGeneration((n) => n + 1);
  }, []);

  return { state, reload, refresh, show };
}
