import type { LeadResult, Offer } from '@heloc/contracts';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { Spinner } from '@/components/form-controls';
import { formatAprRange, formatDate, formatDateTime, formatTerm, formatUsd } from '@/lib/format';
import { documentLabel, rejectionExplanation } from '@/lib/labels';

type Tone = 'success' | 'neutral' | 'info' | 'warning' | 'danger';

const TONES: Record<Tone, string> = {
  success: 'bg-emerald-100 text-emerald-700',
  neutral: 'bg-slate-100 text-slate-600',
  info: 'bg-sky-100 text-sky-700',
  warning: 'bg-amber-100 text-amber-700',
  danger: 'bg-red-100 text-red-700',
};

const ICONS: Record<Tone, ReactNode> = {
  success: (
    <path d="M16.7 5.3a1 1 0 0 1 0 1.4l-8 8a1 1 0 0 1-1.4 0l-4-4a1 1 0 1 1 1.4-1.4L8 12.58l7.3-7.3a1 1 0 0 1 1.4 0Z" />
  ),
  neutral: (
    <path d="M10 2a8 8 0 1 0 0 16 8 8 0 0 0 0-16Zm0 3.5a1 1 0 0 1 1 1V10a1 1 0 1 1-2 0V6.5a1 1 0 0 1 1-1Zm0 9a1.1 1.1 0 1 1 0-2.2 1.1 1.1 0 0 1 0 2.2Z" />
  ),
  info: (
    <path d="M4 3.5A1.5 1.5 0 0 1 5.5 2h6.38a1.5 1.5 0 0 1 1.06.44l2.62 2.62A1.5 1.5 0 0 1 16 6.12V16.5a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 4 16.5v-13ZM7 9a.75.75 0 0 0 0 1.5h6A.75.75 0 0 0 13 9H7Zm0 3a.75.75 0 0 0 0 1.5h6a.75.75 0 0 0 0-1.5H7Z" />
  ),
  warning: (
    <path d="M8.26 3.1a2 2 0 0 1 3.48 0l6.02 10.66A2 2 0 0 1 16.02 16.75H3.98a2 2 0 0 1-1.74-2.99L8.26 3.1ZM10 7a.9.9 0 0 0-.9.9v3.2a.9.9 0 1 0 1.8 0V7.9A.9.9 0 0 0 10 7Zm0 7.6a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z" />
  ),
  danger: (
    <path d="M10 2a8 8 0 1 0 0 16 8 8 0 0 0 0-16Zm0 3.5a1 1 0 0 1 1 1V10a1 1 0 1 1-2 0V6.5a1 1 0 0 1 1-1Zm0 9a1.1 1.1 0 1 1 0-2.2 1.1 1.1 0 0 1 0 2.2Z" />
  ),
};

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <section
      className={`rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8 ${className ?? ''}`}
    >
      {children}
    </section>
  );
}

function CardHeader({
  tone,
  title,
  children,
}: {
  tone: Tone;
  title: string;
  children?: ReactNode;
}) {
  return (
    <div>
      <span className={`flex size-11 items-center justify-center rounded-full ${TONES[tone]}`}>
        <svg aria-hidden viewBox="0 0 20 20" fill="currentColor" className="size-6">
          {ICONS[tone]}
        </svg>
      </span>
      <h1 className="mt-5 text-2xl font-semibold tracking-tight text-balance text-slate-900 sm:text-3xl">
        {title}
      </h1>
      {children && <div className="mt-2 text-pretty text-slate-600">{children}</div>}
    </div>
  );
}

const primaryButton =
  'inline-flex items-center justify-center gap-2 rounded-lg bg-emerald-700 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-800 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-emerald-600/30 disabled:cursor-wait disabled:bg-emerald-700/80';
const secondaryButton =
  'inline-flex items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-5 py-2.5 text-sm font-semibold text-slate-700 shadow-xs transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-slate-400/25';

export function StartOverLink({ children = 'Start a new application' }: { children?: ReactNode }) {
  return (
    <Link href="/" className={secondaryButton}>
      {children}
    </Link>
  );
}

export function OfferCard({ offer }: { offer: Offer }) {
  const terms = [
    { label: 'APR range', value: formatAprRange(offer.apr_min, offer.apr_max) },
    { label: 'Term', value: formatTerm(offer.term_months) },
    {
      label: 'Est. monthly payment',
      value: (
        <>
          {formatUsd(offer.estimated_monthly_payment)}
          <span className="text-base font-normal text-slate-500">/mo</span>
        </>
      ),
    },
    { label: 'Offer expires', value: formatDate(offer.expires_at) },
  ];
  return (
    <Card>
      <CardHeader tone="success" title="You're prequalified">
        Good news: based on what you told us, here is the line of credit you could open.
      </CardHeader>

      <div className="mt-8 overflow-hidden rounded-xl border border-emerald-200">
        <div className="bg-emerald-50/70 px-5 py-6 sm:px-6">
          <p className="text-sm font-medium text-emerald-800">Home equity line up to</p>
          <p className="mt-1 text-4xl font-semibold tracking-tight text-slate-900 tabular-nums sm:text-5xl">
            {formatUsd(offer.amount)}
          </p>
          <p className="mt-2 text-sm text-slate-600">
            Offered by <span className="font-medium text-slate-900">{offer.lender}</span>
          </p>
        </div>
        {/* The 1px gap over a tinted background draws the grid lines. */}
        <dl className="grid gap-px border-t border-emerald-200 bg-slate-200 sm:grid-cols-2">
          {terms.map((term) => (
            <div
              key={term.label}
              className="flex items-baseline justify-between gap-4 bg-white px-5 py-3.5 sm:block sm:px-6 sm:py-4"
            >
              <dt className="text-xs font-medium tracking-wide text-slate-500 uppercase">
                {term.label}
              </dt>
              <dd className="text-base font-semibold whitespace-nowrap text-slate-900 tabular-nums sm:mt-1 sm:text-xl">
                {term.value}
              </dd>
            </div>
          ))}
        </dl>
      </div>

      <p className="mt-5 text-xs leading-relaxed text-slate-500">
        The estimated payment assumes the full line is drawn and repaid over the term at the lowest
        APR. Prequalification is not a commitment to lend; final terms depend on verifying your
        information.
      </p>
    </Card>
  );
}

export function RejectedCard({ reason }: { reason?: string | undefined }) {
  const explanation = rejectionExplanation(reason);
  return (
    <Card>
      <CardHeader tone="neutral" title="We can't offer you a line of credit right now">
        Thanks for checking with us. Here is what we found.
      </CardHeader>
      <div className="mt-6 rounded-xl bg-slate-50 px-5 py-4">
        <p className="font-medium text-slate-900">{explanation.title}</p>
        <p className="mt-1 text-sm text-slate-600">{explanation.body}</p>
      </div>
      <p className="mt-5 text-sm text-slate-600">
        Checking your options used a soft credit inquiry, so your credit score is not affected.
      </p>
      <div className="mt-6">
        <StartOverLink>Check again with different details</StartOverLink>
      </div>
    </Card>
  );
}

export function DocumentsCard({ lead }: { lead: LeadResult }) {
  const documents = lead.documents ?? [];
  const chase = lead.chase;
  return (
    <Card>
      <CardHeader tone="info" title="We need a few documents to continue">
        You are almost there. To finish prequalifying you, we need to verify a few details.
      </CardHeader>

      <ul className="mt-6 divide-y divide-slate-200 rounded-xl border border-slate-200">
        {documents.map((doc) => (
          <li key={doc.type} className="flex gap-4 px-5 py-4">
            <span
              aria-hidden
              className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-500"
            >
              <svg viewBox="0 0 20 20" fill="currentColor" className="size-4">
                {ICONS.info}
              </svg>
            </span>
            <div>
              <p className="font-medium text-slate-900">{documentLabel(doc.type)}</p>
              <p className="mt-0.5 text-sm text-slate-600">{doc.reason}</p>
            </div>
          </li>
        ))}
      </ul>

      {chase?.status === 'sent' ? (
        <div className="mt-6 flex gap-3 rounded-xl bg-emerald-50 px-5 py-4 text-sm text-emerald-900">
          <MailIcon />
          <p>
            <span className="font-medium">We&apos;ve emailed you a checklist</span> with everything
            you need
            {chase.sent_at && <> (sent {formatDateTime(chase.sent_at)})</>}. Check your inbox, and
            your spam folder just in case.
          </p>
        </div>
      ) : (
        <div className="mt-6 flex gap-3 rounded-xl bg-slate-50 px-5 py-4 text-sm text-slate-700">
          <MailIcon />
          <p>We&apos;re sending you an email with a checklist of these documents.</p>
        </div>
      )}
    </Card>
  );
}

function MailIcon() {
  return (
    <svg aria-hidden viewBox="0 0 20 20" fill="currentColor" className="mt-0.5 size-5 shrink-0">
      <path d="M3 4a2 2 0 0 0-2 2v1.16l8.47 4.24a1.2 1.2 0 0 0 1.06 0L19 7.16V6a2 2 0 0 0-2-2H3Z" />
      <path d="m19 8.84-7.8 3.9a2.7 2.7 0 0 1-2.4 0L1 8.84V14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V8.84Z" />
    </svg>
  );
}

export function FailedCard({
  error,
  replaying,
  replayError,
  onReplay,
}: {
  error?: string | undefined;
  replaying: boolean;
  replayError?: string | undefined;
  onReplay: () => void;
}) {
  return (
    <Card>
      <CardHeader tone="warning" title="We hit a snag checking your options">
        Your application is saved. Try again and we&apos;ll pick up right where we left off; you
        won&apos;t need to re-enter anything.
      </CardHeader>
      {error && (
        <p className="mt-5 rounded-lg bg-slate-50 px-4 py-3 font-mono text-xs break-words text-slate-600">
          {error}
        </p>
      )}
      {replayError && (
        <p role="alert" className="mt-4 text-sm text-red-700">
          {replayError}
        </p>
      )}
      <div className="mt-6">
        <button
          type="button"
          onClick={onReplay}
          disabled={replaying}
          className={`w-full sm:w-auto ${primaryButton}`}
        >
          {replaying && <Spinner className="size-4" />}
          {replaying ? 'Trying again…' : 'Try again'}
        </button>
      </div>
    </Card>
  );
}

export function PendingCard({
  stalled,
  onCheckAgain,
}: {
  stalled: boolean;
  onCheckAgain: () => void;
}) {
  return (
    <Card>
      <div className="flex flex-col items-start">
        {stalled ? (
          <CardHeader tone="neutral" title="This is taking longer than usual">
            We&apos;re still working on your application. Check again in a moment.
          </CardHeader>
        ) : (
          <>
            <Spinner className="size-10 text-emerald-700" />
            <h1 className="mt-5 text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">
              Checking your options…
            </h1>
            <p className="mt-2 text-slate-600" role="status">
              This usually takes a few seconds.
            </p>
          </>
        )}
        {stalled && (
          <button type="button" onClick={onCheckAgain} className={`mt-6 ${primaryButton}`}>
            Check again
          </button>
        )}
      </div>
    </Card>
  );
}

export function NotFoundCard() {
  return (
    <Card>
      <CardHeader tone="neutral" title="We couldn't find that application">
        The link may be incomplete or out of date. You can start a new application in about two
        minutes.
      </CardHeader>
      <div className="mt-6">
        <Link href="/" className={primaryButton}>
          Start a new application
        </Link>
      </div>
    </Card>
  );
}

export function LoadErrorCard({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <Card>
      <CardHeader tone="warning" title="We couldn't load your application">
        {message}
      </CardHeader>
      <div className="mt-6">
        <button type="button" onClick={onRetry} className={primaryButton}>
          Try again
        </button>
      </div>
    </Card>
  );
}

export function LoadingCard() {
  return (
    <Card>
      <div role="status" aria-label="Loading your application" className="animate-pulse">
        <div className="size-11 rounded-full bg-slate-100" />
        <div className="mt-5 h-7 w-2/3 rounded bg-slate-100" />
        <div className="mt-3 h-4 w-full rounded bg-slate-100" />
        <div className="mt-8 h-40 rounded-xl bg-slate-100" />
      </div>
    </Card>
  );
}
