'use client';

import type { LeadResult } from '@heloc/contracts';
import { useState } from 'react';
import { leadApi } from '@/lib/api';
import { ApplicationDetails } from './application-details';
import {
  decisionContext,
  DocumentsCard,
  DocumentsReceivedCard,
  FailedCard,
  LoadErrorCard,
  LoadingCard,
  NotFoundCard,
  OfferCard,
  PendingCard,
  RejectedCard,
  StartOverLink,
  type Watch,
} from './status-cards';
import { useLead } from './use-lead';

/**
 * The result page: shows a Lead's decision, the documents still needed and how to send
 * them, the Document Review in progress, or a failure + Replay.
 */
export function LeadResultView({ leadId }: { leadId: string }) {
  const { state, reload, refresh, show } = useLead(leadId);
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
    case 'ready': {
      const { lead, stalled, watching, checking, checkFailed, checkedAt } = state;
      return (
        <div className="space-y-6">
          <StatusCard
            lead={lead}
            stalled={stalled}
            watch={{ watching, checking, checkFailed, checkedAt, onCheckAgain: refresh }}
            replay={{ replaying, replayError, onReplay: replay }}
          />
          <ApplicationDetails lead={lead} />
          {lead.status !== 'rejected' && !hasRejection(lead) && (
            <div className="flex justify-center">
              <StartOverLink />
            </div>
          )}
        </div>
      );
    }
  }
}

/** A failed Outcome Notice still has a decision to show (the RejectedCard has its own link). */
function hasRejection(lead: LeadResult): boolean {
  return lead.status === 'failed' && lead.failed_step === 'notify' && !lead.offer && !!lead.reason;
}

function StatusCard({
  lead,
  stalled,
  watch,
  replay,
}: {
  lead: LeadResult;
  stalled: boolean;
  watch: Watch;
  replay: { replaying: boolean; replayError: string | undefined; onReplay: () => void };
}) {
  switch (lead.status) {
    case 'approved':
      return lead.offer ? (
        <OfferCard offer={lead.offer} context={decisionContext(lead)} />
      ) : (
        <PendingCard stalled onCheckAgain={watch.onCheckAgain} />
      );
    case 'rejected':
      return <RejectedCard reason={lead.reason} context={decisionContext(lead)} />;
    case 'need_more_documents':
    case 'chase_sent':
      return <DocumentsCard lead={lead} watch={watch} />;
    case 'documents_received':
      return <DocumentsReceivedCard lead={lead} stalled={stalled} watch={watch} />;
    case 'failed':
      return (
        <>
          <FailedCard step={lead.failed_step} error={lead.error} {...replay} />
          {/* Failing to send the Outcome Notice doesn't undo the decision: show it. */}
          {lead.failed_step === 'notify' &&
            (lead.offer ? (
              <OfferCard offer={lead.offer} context={decisionContext(lead)} />
            ) : (
              lead.reason && <RejectedCard reason={lead.reason} context={decisionContext(lead)} />
            ))}
        </>
      );
    case 'submitted':
    case 'processing':
      return <PendingCard stalled={stalled} onCheckAgain={watch.onCheckAgain} />;
  }
}
