import type { OverviewSummary } from '@/lib/ops-view';

/** The page's headline: all clear, or how many things need a look and what they are. */
export function Summary({ summary }: { summary: OverviewSummary }) {
  const clear = summary.issues === 0;
  const tone = !clear
    ? { box: 'border-red-200 bg-red-50/60', icon: 'bg-red-100 text-red-700' }
    : summary.unavailable.length > 0
      ? { box: 'border-slate-200 bg-white', icon: 'bg-emerald-100 text-emerald-700' }
      : { box: 'border-emerald-200 bg-emerald-50/60', icon: 'bg-emerald-100 text-emerald-700' };
  return (
    <section
      aria-labelledby="summary-title"
      className={`flex gap-4 rounded-2xl border p-5 shadow-sm sm:p-6 ${tone.box}`}
    >
      <span
        aria-hidden
        className={`flex size-10 shrink-0 items-center justify-center rounded-full ${tone.icon}`}
      >
        <svg viewBox="0 0 20 20" fill="currentColor" className="size-5">
          {clear ? (
            <path d="M16.7 5.3a1 1 0 0 1 0 1.4l-8 8a1 1 0 0 1-1.4 0l-4-4a1 1 0 1 1 1.4-1.4L8 12.58l7.3-7.3a1 1 0 0 1 1.4 0Z" />
          ) : (
            <path d="M8.26 3.1a2 2 0 0 1 3.48 0l6.02 10.66A2 2 0 0 1 16.02 16.75H3.98a2 2 0 0 1-1.74-2.99L8.26 3.1ZM10 7a.9.9 0 0 0-.9.9v3.2a.9.9 0 1 0 1.8 0V7.9A.9.9 0 0 0 10 7Zm0 7.6a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z" />
          )}
        </svg>
      </span>
      <div className="min-w-0">
        <h2 id="summary-title" className="text-lg font-semibold text-slate-900">
          {summary.headline}
        </h2>
        {summary.details.length > 0 && (
          <p className="mt-0.5 text-sm text-slate-700">{summary.details.join(' · ')}</p>
        )}
        {summary.unavailable.length > 0 && (
          <p className="mt-1 text-sm text-amber-800">
            Couldn&apos;t check {summary.unavailable.join(', ')}; see below.
          </p>
        )}
      </div>
    </section>
  );
}
