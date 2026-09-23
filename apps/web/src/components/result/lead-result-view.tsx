'use client';

import type { LeadResult } from '@heloc/contracts';
import { useState } from 'react';
import { leadApi } from '@/lib/api';
import { ApplicationDetails } from './application-details';
import {
  DocumentsCard,
  FailedCard,
  LoadErrorCard,
  LoadingCard,
  NotFoundCard,
  OfferCard,
  PendingCard,
  RejectedCard,
  StartOverLink,
} from './status-cards';
import { useLead } from './use-lead';

/** The result page: shows a Lead's Prequal Decision, Missing Documents, or failure + Replay. */
export function LeadResultView({ leadId }: { leadId: string }) {
  const { state, reload, show } = useLead(leadId);
  const [replaying, setReplaying] = useState(false);
  const [replayError, setReplayError] = useState<string>();

  async function replay() {
    setReplaying(true);
    setReplayError(undefined);
    const result = await leadApi.replayLead(leadId);
    setReplaying(false);
    switch (result.kind) {
      case 'lead':
        show(result.lead);
        if (result.lead.status === 'failed') {
          setReplayError("We still couldn't finish. Please try again in a moment.");
        }
        return;
      case 'conflict':
        // Someone (another tab, a double click) is already replaying this Lead.
        setReplayError('We are already retrying your application. Refreshing…');
        reload();
        return;
      case 'not_found':
        reload();
        return;
      case 'error':
        setReplayError(result.message);
        return;
      default:
        setReplayError('Something went wrong. Please try again.');
    }
  }

  switch (state.phase) {
    case 'loading':
      return <LoadingCard />;
    case 'not_found':
      return <NotFoundCard />;
    case 'error':
      return <LoadErrorCard message={state.message} onRetry={reload} />;
    case 'ready':
      return (
        <div className="space-y-6">
          <StatusCard
            lead={state.lead}
            stalled={state.stalled}
            onCheckAgain={reload}
            replay={{ replaying, replayError, onReplay: replay }}
          />
          <ApplicationDetails lead={state.lead} />
          {state.lead.status !== 'rejected' && (
            <div className="flex justify-center">
              <StartOverLink />
            </div>
          )}
        </div>
      );
  }
}

function StatusCard({
  lead,
  stalled,
  onCheckAgain,
  replay,
}: {
  lead: LeadResult;
  stalled: boolean;
  onCheckAgain: () => void;
  replay: { replaying: boolean; replayError: string | undefined; onReplay: () => void };
}) {
  switch (lead.status) {
    case 'approved':
      return lead.offer ? (
        <OfferCard offer={lead.offer} />
      ) : (
        <PendingCard stalled onCheckAgain={onCheckAgain} />
      );
    case 'rejected':
      return <RejectedCard reason={lead.reason} />;
    case 'need_more_documents':
    case 'chase_sent':
      return <DocumentsCard lead={lead} />;
    case 'failed':
      return <FailedCard error={lead.error} {...replay} />;
    case 'submitted':
    case 'processing':
      return <PendingCard stalled={stalled} onCheckAgain={onCheckAgain} />;
  }
}
