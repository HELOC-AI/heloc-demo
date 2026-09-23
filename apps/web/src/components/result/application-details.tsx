'use client';

import type { LeadResult } from '@heloc/contracts';
import { useState } from 'react';
import { formatDateTime, formatTime } from '@/lib/format';
import { EVENT_LABELS, eventDetail, STATUS_LABELS } from '@/lib/labels';

/** The Lead id (for support and Replay) and its Lead Events, oldest first. */
export function ApplicationDetails({ lead }: { lead: LeadResult }) {
  const events = lead.events ?? [];
  return (
    <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-col gap-3 px-6 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-8">
        <LeadId id={lead.lead_id} />
        <span className="self-start rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700 sm:self-auto">
          {STATUS_LABELS[lead.status]}
        </span>
      </div>

      {events.length > 0 && (
        <details className="group border-t border-slate-200">
          <summary className="flex cursor-pointer list-none items-center justify-between px-6 py-4 text-sm font-medium text-slate-700 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-emerald-600/20 sm:px-8 [&::-webkit-details-marker]:hidden">
            <span>
              Application timeline{' '}
              <span className="font-normal text-slate-500">({events.length} events)</span>
            </span>
            <svg
              aria-hidden
              viewBox="0 0 20 20"
              fill="currentColor"
              className="size-5 text-slate-400 transition group-open:rotate-180"
            >
              <path
                fillRule="evenodd"
                d="M5.22 8.22a.75.75 0 0 1 1.06 0L10 11.94l3.72-3.72a.75.75 0 1 1 1.06 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L5.22 9.28a.75.75 0 0 1 0-1.06Z"
                clipRule="evenodd"
              />
            </svg>
          </summary>
          <ol className="px-6 pt-1 pb-6 sm:px-8">
            {events.map((event, i) => {
              const detail = eventDetail(event);
              const last = i === events.length - 1;
              const bad = event.type === 'lead.failed' || event.type === 'email.failed';
              return (
                <li
                  key={`${event.type}-${event.created_at}-${i}`}
                  className="relative flex gap-4 pb-5 last:pb-0"
                >
                  {!last && (
                    <span
                      aria-hidden
                      className="absolute top-4 left-[5px] h-full w-px bg-slate-200"
                    />
                  )}
                  <span
                    aria-hidden
                    className={`relative mt-1.5 size-[11px] shrink-0 rounded-full ring-4 ring-white ${
                      bad ? 'bg-amber-500' : last ? 'bg-emerald-600' : 'bg-slate-300'
                    }`}
                  />
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5 sm:flex-row sm:justify-between sm:gap-4">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-slate-900">
                        {EVENT_LABELS[event.type]}
                      </p>
                      {detail && <p className="text-sm break-words text-slate-500">{detail}</p>}
                    </div>
                    <time
                      dateTime={event.created_at}
                      title={formatDateTime(event.created_at)}
                      className="shrink-0 text-xs text-slate-500 tabular-nums sm:pt-0.5"
                    >
                      {formatTime(event.created_at)}
                    </time>
                  </div>
                </li>
              );
            })}
          </ol>
        </details>
      )}
    </section>
  );
}

function LeadId({ id }: { id: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(id);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard can be unavailable (permissions, insecure context); the id stays selectable.
    }
  }

  return (
    <div className="min-w-0">
      <div className="flex items-center gap-2">
        <h2 className="text-sm font-medium text-slate-500">Application ID</h2>
        <button
          type="button"
          onClick={copy}
          className="rounded-md px-1.5 py-0.5 text-xs font-medium text-emerald-700 hover:bg-emerald-50 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-emerald-600/20"
          aria-label={copied ? 'Application ID copied' : 'Copy application ID'}
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
        <span className="sr-only" aria-live="polite">
          {copied ? 'Copied to clipboard' : ''}
        </span>
      </div>
      <code className="mt-0.5 block font-mono text-xs break-all text-slate-900 select-all sm:text-sm">
        {id}
      </code>
    </div>
  );
}
