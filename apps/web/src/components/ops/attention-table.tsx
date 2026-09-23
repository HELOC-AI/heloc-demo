'use client';

import type { AttentionLead } from '@heloc/ops';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Spinner } from '@/components/form-controls';
import { leadApi, type ApiResult } from '@/lib/api';
import { formatUtcShort, humanize, shortLeadId } from '@/lib/ops-view';
import { Ago, Badge } from './ui';

const STUCK_CONFIRM = 'This Lead may still be in progress. Replay only if it is stuck.';

interface ReplayOutcome {
  leadId: string;
  ok: boolean;
  message: string;
}

/**
 * Failed and stuck Leads, each with Replay: it resumes from whatever step the Lead still needs
 * (intake answers 409 to a concurrent replay). Replay goes through the public Lead API, exactly
 * like the result page's "Try again". The last outcome stays up across refreshes, even once the
 * Lead has left the list.
 */
export function AttentionTable({ leads, now }: { leads: AttentionLead[]; now: string }) {
  const router = useRouter();
  const [replaying, setReplaying] = useState<string>();
  const [outcome, setOutcome] = useState<ReplayOutcome>();

  async function replay(lead: AttentionLead) {
    // A Lead that has not failed may just be slow; replaying it then would run a step twice.
    if (lead.status !== 'failed' && !window.confirm(STUCK_CONFIRM)) return;
    const leadId = lead.lead_id;
    setReplaying(leadId);
    setOutcome(undefined);
    const result = await leadApi.replayLead(leadId);
    setReplaying(undefined);
    setOutcome({ leadId, ...describe(result) });
    router.refresh();
  }

  return (
    <div>
      <div aria-live="polite">
        {outcome && (
          <p
            className={`flex flex-wrap items-center gap-x-2 border-b px-5 py-3 text-sm sm:px-6 ${
              outcome.ok
                ? 'border-emerald-200 bg-emerald-50/70 text-emerald-900'
                : 'border-amber-200 bg-amber-50/70 text-amber-900'
            }`}
          >
            <span className="font-medium">
              Replay of <code className="font-mono">{shortLeadId(outcome.leadId)}</code>:
            </span>
            {outcome.message}
          </p>
        )}
      </div>

      {leads.length === 0 ? (
        <div className="flex items-center gap-3 px-5 py-8 sm:px-6">
          <span
            aria-hidden
            className="flex size-8 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-700"
          >
            <svg viewBox="0 0 20 20" fill="currentColor" className="size-4">
              <path d="M16.7 5.3a1 1 0 0 1 0 1.4l-8 8a1 1 0 0 1-1.4 0l-4-4a1 1 0 1 1 1.4-1.4L8 12.58l7.3-7.3a1 1 0 0 1 1.4 0Z" />
            </svg>
          </span>
          <div>
            <p className="font-medium text-slate-900">Nothing needs attention</p>
            <p className="text-sm text-slate-500">No failed or stuck Leads.</p>
          </div>
        </div>
      ) : (
        <>
          {/* Narrow screens: one card per Lead. */}
          <ul className="divide-y divide-slate-200 md:hidden">
            {leads.map((lead) => (
              <li key={lead.lead_id} className="space-y-2 px-5 py-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <LeadLink leadId={lead.lead_id} />
                    <div className="mt-1">
                      <LeadStatus lead={lead} now={now} />
                    </div>
                  </div>
                  <ReplayButton lead={lead} replaying={replaying} onReplay={replay} />
                </div>
                {lead.failed_step && (
                  <p className="text-sm text-slate-700">
                    Failed at <span className="font-medium">{humanize(lead.failed_step)}</span>
                  </p>
                )}
                {lead.error && <LeadError error={lead.error} />}
                <p className="text-xs text-slate-500">
                  Updated <Ago date={new Date(lead.updated_at)} now={new Date(now)} />
                </p>
              </li>
            ))}
          </ul>

          <table className="hidden w-full text-left text-sm md:table">
            <thead className="bg-slate-50 text-xs text-slate-500">
              <tr>
                <th scope="col" className="py-2 pr-4 pl-6 font-medium">
                  Lead
                </th>
                <th scope="col" className="px-4 py-2 font-medium">
                  Status
                </th>
                <th scope="col" className="px-4 py-2 font-medium">
                  Failed step
                </th>
                <th scope="col" className="px-4 py-2 font-medium">
                  Error
                </th>
                <th scope="col" className="px-4 py-2 font-medium">
                  Updated
                </th>
                <th scope="col" className="relative py-2 pr-6 pl-4">
                  <span className="sr-only">Action</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {leads.map((lead) => (
                <tr key={lead.lead_id} className="align-top">
                  <td className="py-3 pr-4 pl-6">
                    <LeadLink leadId={lead.lead_id} />
                  </td>
                  <td className="px-4 py-3">
                    <LeadStatus lead={lead} now={now} />
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-slate-700">
                    {lead.failed_step ? humanize(lead.failed_step) : <Missing />}
                  </td>
                  <td className="max-w-md px-4 py-3">
                    {lead.error ? <LeadError error={lead.error} /> : <Missing />}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-slate-600">
                    <Ago date={new Date(lead.updated_at)} now={new Date(now)} />
                  </td>
                  <td className="py-2 pr-6 pl-4 text-right">
                    <ReplayButton lead={lead} replaying={replaying} onReplay={replay} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}

function LeadLink({ leadId }: { leadId: string }) {
  return (
    <Link
      href={`/result/${leadId}`}
      title={leadId}
      className="rounded font-mono text-sm text-emerald-700 hover:text-emerald-800 hover:underline focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-emerald-600/20"
    >
      {shortLeadId(leadId)}
    </Link>
  );
}

function LeadStatus({ lead, now }: { lead: AttentionLead; now: string }) {
  if (lead.status === 'failed') return <Badge tone="bad">Failed</Badge>;
  return (
    <>
      <Badge tone="warn">Stuck</Badge>
      <p className="mt-1 text-xs text-slate-500">
        in {humanize(lead.status).toLowerCase()} since{' '}
        <span className="whitespace-nowrap">
          {formatUtcShort(new Date(lead.updated_at), new Date(now))}
        </span>
      </p>
    </>
  );
}

function LeadError({ error }: { error: string }) {
  return <p className="font-mono text-xs break-words text-slate-700">{error}</p>;
}

function Missing() {
  return (
    <span className="text-slate-400">
      <span aria-hidden>—</span>
      <span className="sr-only">none</span>
    </span>
  );
}

function ReplayButton({
  lead,
  replaying,
  onReplay,
}: {
  lead: AttentionLead;
  /** The Lead being replayed, if any: one at a time. */
  replaying: string | undefined;
  onReplay: (lead: AttentionLead) => void;
}) {
  const busy = replaying === lead.lead_id;
  return (
    <button
      type="button"
      onClick={() => onReplay(lead)}
      disabled={replaying !== undefined}
      aria-label={`Replay Lead ${shortLeadId(lead.lead_id)}`}
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-semibold shadow-sm transition focus-visible:outline-none focus-visible:ring-4 disabled:cursor-not-allowed disabled:opacity-60 ${
        // Stuck Leads may still be moving: a quieter button, and a confirm.
        lead.status === 'failed'
          ? 'bg-emerald-700 text-white hover:bg-emerald-800 focus-visible:ring-emerald-600/30'
          : 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 focus-visible:ring-slate-400/25'
      }`}
    >
      {busy && <Spinner className="size-3.5" />}
      {busy ? 'Replaying…' : 'Replay'}
    </button>
  );
}

function describe(result: ApiResult): Omit<ReplayOutcome, 'leadId'> {
  switch (result.kind) {
    case 'lead': {
      const { lead } = result;
      if (lead.status === 'failed') {
        const step = lead.failed_step ? ` at ${humanize(lead.failed_step).toLowerCase()}` : '';
        return {
          ok: false,
          message: `Failed again${step}${lead.error ? `: ${lead.error}` : '.'}`,
        };
      }
      return {
        ok: true,
        message: `Resumed. The Lead is now ${humanize(lead.status).toLowerCase()}.`,
      };
    }
    case 'conflict':
      return { ok: false, message: 'A replay of this Lead is already running.' };
    case 'not_found':
      return { ok: false, message: 'Intake no longer knows this Lead.' };
    case 'error':
      return { ok: false, message: result.message };
    default:
      return { ok: false, message: 'Intake rejected the request.' };
  }
}
