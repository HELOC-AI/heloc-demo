import type { Section } from '@heloc/ops';
import type { ReactNode } from 'react';
import { formatAgo } from '@/lib/ops-view';

/** Building blocks shared by the /ops panels. */

export type Tone = 'ok' | 'warn' | 'bad' | 'neutral' | 'info';

const BADGE_TONES: Record<Tone, { badge: string; dot: string }> = {
  ok: { badge: 'bg-emerald-50 text-emerald-800 ring-emerald-600/20', dot: 'bg-emerald-500' },
  warn: { badge: 'bg-amber-50 text-amber-800 ring-amber-600/25', dot: 'bg-amber-500' },
  bad: { badge: 'bg-red-50 text-red-800 ring-red-600/20', dot: 'bg-red-500' },
  neutral: { badge: 'bg-slate-100 text-slate-700 ring-slate-500/15', dot: 'bg-slate-400' },
  info: { badge: 'bg-sky-50 text-sky-800 ring-sky-600/20', dot: 'bg-sky-500' },
};

/** A status pill: the label carries the meaning, the dot only reinforces it. */
export function Badge({ tone, children }: { tone: Tone; children: ReactNode }) {
  const { badge, dot } = BADGE_TONES[tone];
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap ring-1 ring-inset ${badge}`}
    >
      <span aria-hidden className={`size-1.5 rounded-full ${dot}`} />
      {children}
    </span>
  );
}

export function Panel({
  id,
  title,
  description,
  aside,
  flush = false,
  children,
}: {
  id: string;
  title: string;
  description?: ReactNode;
  aside?: ReactNode;
  /** Content runs edge to edge (tables). */
  flush?: boolean;
  children: ReactNode;
}) {
  return (
    <section
      aria-labelledby={`${id}-title`}
      className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"
    >
      <div className="flex flex-col gap-2 border-b border-slate-200 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <div className="min-w-0">
          <h2 id={`${id}-title`} className="font-semibold text-slate-900">
            {title}
          </h2>
          {description && <p className="mt-0.5 text-sm text-slate-500">{description}</p>}
        </div>
        {aside && <div className="shrink-0">{aside}</div>}
      </div>
      <div className={flush ? '' : 'p-5 sm:p-6'}>{children}</div>
    </section>
  );
}

/** Renders a loaded section, or why it could not be loaded (one failing source hides nothing else). */
export function SectionBody<T>({
  section,
  flush = false,
  children,
}: {
  section: Section<T>;
  /** The panel has no padding of its own; pad the error box. */
  flush?: boolean;
  children: (data: T) => ReactNode;
}) {
  if (section.ok) return children(section.data);
  return (
    <div className={flush ? 'p-5 sm:p-6' : ''}>
      <div className="flex gap-3 rounded-xl border border-amber-200 bg-amber-50/60 px-4 py-3">
        <svg
          aria-hidden
          viewBox="0 0 20 20"
          fill="currentColor"
          className="mt-0.5 size-4 shrink-0 text-amber-600"
        >
          <path d="M8.26 3.1a2 2 0 0 1 3.48 0l6.02 10.66A2 2 0 0 1 16.02 16.75H3.98a2 2 0 0 1-1.74-2.99L8.26 3.1ZM10 7a.9.9 0 0 0-.9.9v3.2a.9.9 0 1 0 1.8 0V7.9A.9.9 0 0 0 10 7Zm0 7.6a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z" />
        </svg>
        <div className="min-w-0 text-sm">
          <p className="font-medium text-amber-900">Couldn&apos;t load this section</p>
          <p className="mt-0.5 font-mono text-xs break-words text-amber-900/80">{section.error}</p>
        </div>
      </div>
    </div>
  );
}

/** A link that leaves the app, opened in a new tab. */
export function ExternalLink({
  href,
  className,
  children,
}: {
  href: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className={
        className ??
        'inline-flex items-center gap-1 rounded font-medium text-emerald-700 hover:text-emerald-800 hover:underline focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-emerald-600/20'
      }
    >
      {children}
      <svg aria-hidden viewBox="0 0 20 20" fill="currentColor" className="size-3.5 shrink-0">
        <path d="M11 3a1 1 0 1 0 0 2h2.59l-6.3 6.3a1 1 0 1 0 1.42 1.4L15 6.42V9a1 1 0 1 0 2 0V4a1 1 0 0 0-1-1h-5Z" />
        <path d="M5 5a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2v-3a1 1 0 1 0-2 0v3H5V7h3a1 1 0 0 0 0-2H5Z" />
      </svg>
      <span className="sr-only">(opens in a new tab)</span>
    </a>
  );
}

/** A timestamp shown relative to the overview, with the exact UTC time on hover. */
export function Ago({ date, now }: { date: Date; now: Date }) {
  return (
    <time
      dateTime={date.toISOString()}
      title={`${date.toISOString().replace('T', ' ').slice(0, 19)} UTC`}
    >
      {formatAgo(date, now)}
    </time>
  );
}

export const RUNBOOK_URL = 'https://github.com/HELOC-AI/heloc-demo/blob/main/docs/RUNBOOK.md';
export const DASHBOARDS_URL = 'https://telemetry.betterstack.com/team/t602815/dashboards';
