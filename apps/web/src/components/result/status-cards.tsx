import type { LeadResult, LeadStep, Offer, RejectionReason } from '@heloc/contracts';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { Spinner } from '@/components/form-controls';
import { replyMailto } from '@/lib/chase-reply';
import {
  formatAprRange,
  formatDate,
  formatDateTime,
  formatFileSize,
  formatTerm,
  formatTime,
  formatUsd,
} from '@/lib/format';
import { documentLabel, failureCopy, rejectionExplanation } from '@/lib/labels';
import { CopyButton } from './copy-button';

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

export function OfferCard({ offer, context }: { offer: Offer; context: DecisionContext }) {
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
        {context.documentsReceivedAt
          ? 'Good news: Figure reviewed your documents, and here is the line of credit you could open.'
          : 'Good news: based on what you told us, here is the line of credit you could open.'}
      </CardHeader>
      <DecisionNote context={context} />

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

/** How a decision was reached, and whether the Borrower also has it by email. */
export interface DecisionContext {
  /** When the Borrower's documents arrived, if a Document Review made the decision. */
  documentsReceivedAt?: string | undefined;
  /** The Outcome Notice email has gone out. */
  emailed: boolean;
}

export function decisionContext(lead: LeadResult): DecisionContext {
  return {
    documentsReceivedAt: lead.documents_received?.received_at,
    emailed: lead.notice?.status === 'sent',
  };
}

function DecisionNote({ context }: { context: DecisionContext }) {
  if (!context.documentsReceivedAt && !context.emailed) return null;
  return (
    <ul className="mt-5 flex flex-col gap-2 text-sm text-slate-600 sm:flex-row sm:flex-wrap sm:gap-x-6">
      {context.documentsReceivedAt && (
        <li className="flex items-start gap-2">
          <DocumentIcon className="mt-0.5 size-4 shrink-0 text-slate-400" />
          Based on the documents you sent on {formatDate(context.documentsReceivedAt)}
        </li>
      )}
      {context.emailed && (
        <li className="flex items-start gap-2">
          <MailIcon className="mt-0.5 size-4 shrink-0 text-slate-400" />
          We&apos;ve emailed you the result
        </li>
      )}
    </ul>
  );
}

export function RejectedCard({
  reason,
  context,
}: {
  reason?: RejectionReason | undefined;
  context: DecisionContext;
}) {
  const explanation = rejectionExplanation(reason);
  return (
    <Card>
      <CardHeader tone="neutral" title="We can't offer you a line of credit right now">
        {context.documentsReceivedAt
          ? 'Thanks for sending your documents. Figure has reviewed them, and here is what we found.'
          : 'Thanks for checking with us. Here is what we found.'}
      </CardHeader>
      <DecisionNote context={context} />
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

/** Automatic re-checking of a Lead that is waiting on something, plus a manual "Check again". */
export interface Watch {
  watching: boolean;
  checking: boolean;
  checkFailed: boolean;
  checkedAt: number;
  onCheckAgain: () => void;
}

export function DocumentsCard({ lead, watch }: { lead: LeadResult; watch: Watch }) {
  const documents = lead.documents ?? [];
  const chase = lead.chase;
  const replyTo = chase?.status === 'sent' ? chase.reply_to : null;
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
              <DocumentIcon className="size-4" />
            </span>
            <div>
              <p className="font-medium text-slate-900">{documentLabel(doc.type)}</p>
              <p className="mt-0.5 text-sm text-slate-600">{doc.reason}</p>
            </div>
          </li>
        ))}
      </ul>

      {chase && replyTo ? (
        <ReplyInstructions sentTo={chase.sent_to} sentAt={chase.sent_at} replyTo={replyTo} />
      ) : (
        <div className="mt-6 flex gap-3 rounded-xl bg-slate-50 px-5 py-4 text-sm text-slate-700">
          <MailIcon className="mt-0.5 size-5 shrink-0" />
          <p>
            We&apos;re emailing you a checklist of these documents
            {chase?.sent_to && (
              <>
                {' '}
                at <span className="font-medium text-slate-900">{chase.sent_to}</span>
              </>
            )}
            . When it arrives, reply to it with the documents attached.
          </p>
        </div>
      )}

      <WatchFooter watch={watch} waitingFor="Waiting for your reply" />
    </Card>
  );
}

function ReplyInstructions({
  sentTo,
  sentAt,
  replyTo,
}: {
  sentTo: string;
  sentAt: string | null;
  replyTo: string;
}) {
  return (
    <div className="mt-6 rounded-xl border border-emerald-200 bg-emerald-50/60 px-5 py-5">
      <h2 className="flex items-center gap-2 font-semibold text-emerald-950">
        <MailIcon className="size-5 shrink-0 text-emerald-700" />
        How to send your documents
      </h2>
      <p className="mt-2 text-pretty text-emerald-950">
        Reply to the email we sent to <span className="font-semibold">{sentTo}</span> and attach
        these documents.
      </p>
      <p className="mt-1 text-sm text-pretty text-emerald-900/80">
        {sentAt && <>We sent it {formatDateTime(sentAt)}. </>}
        Photos or PDFs are fine. Can&apos;t find it? Check your spam folder, or email them to our
        reply address:
      </p>

      <div className="mt-4 rounded-lg border border-emerald-200 bg-white px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs font-medium tracking-wide text-slate-500 uppercase">
            Reply address
          </p>
          <CopyButton value={replyTo} label="reply address" />
        </div>
        <code className="mt-1 block font-mono text-[13px] text-slate-900 select-all [overflow-wrap:anywhere] sm:text-sm">
          <EmailAddress address={replyTo} />
        </code>
      </div>

      <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <a
          href={replyMailto(replyTo)}
          className={`w-full whitespace-nowrap sm:w-auto ${primaryButton}`}
        >
          <MailIcon className="size-4 shrink-0" />
          Open in your email app
        </a>
        <p className="text-xs text-pretty text-emerald-900/80">
          Send from <span className="font-medium">{sentTo}</span> so we can match your documents to
          your application.
        </p>
      </div>
    </div>
  );
}

/** An email address that, when it must wrap, prefers to break after `+` and before `@`. */
function EmailAddress({ address }: { address: string }) {
  const at = address.lastIndexOf('@');
  const plus = address.indexOf('+');
  if (at < 0) return <>{address}</>;
  const local = address.slice(0, at);
  return (
    <>
      {plus > 0 && plus < at ? (
        <>
          {local.slice(0, plus + 1)}
          <wbr />
          {local.slice(plus + 1)}
        </>
      ) : (
        local
      )}
      <wbr />
      {address.slice(at)}
    </>
  );
}

export function DocumentsReceivedCard({
  lead,
  stalled,
  watch,
}: {
  lead: LeadResult;
  stalled: boolean;
  watch: Watch;
}) {
  const received = lead.documents_received;
  const attachments = received?.attachments ?? [];
  return (
    <Card>
      <CardHeader tone="info" title="We've received your documents">
        Thanks for sending them. Figure is reviewing them now, and this page will show your result
        as soon as they&apos;re done. We&apos;ll email it to you too.
      </CardHeader>

      {received && (
        <div className="mt-6 overflow-hidden rounded-xl border border-slate-200">
          <p className="border-b border-slate-200 bg-slate-50 px-5 py-2.5 text-xs font-medium text-slate-600">
            {attachments.length} {attachments.length === 1 ? 'file' : 'files'} received{' '}
            <time dateTime={received.received_at}>{formatDateTime(received.received_at)}</time>
          </p>
          <ul className="divide-y divide-slate-200">
            {attachments.map((file, i) => (
              <li key={`${file.filename}-${i}`} className="flex items-center gap-3 px-5 py-3">
                <DocumentIcon className="size-4 shrink-0 text-slate-400" />
                <span
                  title={file.filename}
                  className="min-w-0 flex-1 truncate text-sm font-medium text-slate-900"
                >
                  {file.filename}
                </span>
                <span className="shrink-0 text-xs text-slate-500 tabular-nums">
                  {formatFileSize(file.size)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {stalled ? (
        <div className="mt-6 rounded-xl bg-slate-50 px-5 py-4 text-sm text-slate-700">
          <p className="font-medium text-slate-900">This is taking longer than usual</p>
          <p className="mt-0.5">
            Figure is still reviewing your documents. Check again in a moment; we&apos;ll also email
            you the result.
          </p>
        </div>
      ) : (
        <p className="mt-6 flex items-center gap-3 text-sm text-slate-700" role="status">
          <Spinner className="size-4 text-emerald-700" />
          Figure is reviewing your documents…
        </p>
      )}

      <WatchFooter watch={watch} />
    </Card>
  );
}

/** "Waiting…/Last checked" status and a Check again button, under a waiting card. */
function WatchFooter({ watch, waitingFor }: { watch: Watch; waitingFor?: string }) {
  const checkedAt = formatTime(new Date(watch.checkedAt).toISOString());
  return (
    <div className="mt-6 flex flex-col gap-3 border-t border-slate-200 pt-5 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-sm text-slate-600" aria-live="polite">
        {watch.checkFailed ? (
          <span className="text-amber-800">
            We couldn&apos;t check just now.{watch.watching ? ' Trying again shortly.' : ''}
          </span>
        ) : watch.watching && waitingFor ? (
          <span className="flex items-start gap-2">
            <span aria-hidden className="relative mt-1.5 flex size-2 shrink-0">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-500 opacity-60 motion-reduce:hidden" />
              <span className="relative inline-flex size-2 rounded-full bg-emerald-600" />
            </span>
            {waitingFor}. This page updates automatically.
          </span>
        ) : (
          <>Last checked {checkedAt}</>
        )}
      </p>
      <button
        type="button"
        onClick={watch.onCheckAgain}
        disabled={watch.checking}
        className={`shrink-0 ${secondaryButton} disabled:cursor-wait disabled:opacity-70`}
      >
        {watch.checking && <Spinner className="size-4" />}
        {watch.checking ? 'Checking…' : 'Check again'}
      </button>
    </div>
  );
}

function MailIcon({ className }: { className?: string }) {
  return (
    <svg aria-hidden viewBox="0 0 20 20" fill="currentColor" className={className}>
      <path d="M3 4a2 2 0 0 0-2 2v1.16l8.47 4.24a1.2 1.2 0 0 0 1.06 0L19 7.16V6a2 2 0 0 0-2-2H3Z" />
      <path d="m19 8.84-7.8 3.9a2.7 2.7 0 0 1-2.4 0L1 8.84V14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V8.84Z" />
    </svg>
  );
}

function DocumentIcon({ className }: { className?: string }) {
  return (
    <svg aria-hidden viewBox="0 0 20 20" fill="currentColor" className={className}>
      {ICONS.info}
    </svg>
  );
}

export function FailedCard({
  step,
  error,
  replaying,
  replayError,
  onReplay,
}: {
  step?: LeadStep | undefined;
  error?: string | undefined;
  replaying: boolean;
  replayError?: string | undefined;
  onReplay: () => void;
}) {
  const copy = failureCopy(step);
  const details = (surface: string) => (
    <>
      {error && (
        <div className={`mt-5 rounded-lg px-4 py-3 ${surface}`}>
          <p className="text-xs font-medium text-slate-500">Technical details</p>
          <p className="mt-0.5 font-mono text-xs break-words text-slate-600">{error}</p>
        </div>
      )}
      {replayError && (
        <p role="alert" className="mt-4 text-sm text-red-700">
          {replayError}
        </p>
      )}
    </>
  );
  const button = (
    <button
      type="button"
      onClick={onReplay}
      disabled={replaying}
      className={`w-full sm:w-auto ${primaryButton}`}
    >
      {replaying && <Spinner className="size-4" />}
      {replaying ? 'Trying again…' : 'Try again'}
    </button>
  );

  // Only the email failed: the decision below is the page's headline, so stay compact.
  if (step === 'notify') {
    return (
      <section className="rounded-2xl border border-amber-200 bg-amber-50/60 p-5 sm:px-8 sm:py-6">
        <div className="flex gap-3">
          <span
            className={`flex size-8 shrink-0 items-center justify-center rounded-full ${TONES.warning}`}
          >
            <svg aria-hidden viewBox="0 0 20 20" fill="currentColor" className="size-4">
              {ICONS.warning}
            </svg>
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="font-semibold text-slate-900">{copy.title}</h2>
            <p className="mt-1 text-sm text-pretty text-slate-700">{copy.body}</p>
            {details('bg-white/70')}
            <div className="mt-4">{button}</div>
          </div>
        </div>
      </section>
    );
  }

  return (
    <Card>
      <CardHeader tone="warning" title={copy.title}>
        {copy.body}
      </CardHeader>
      {details('bg-slate-50')}
      <div className="mt-6">{button}</div>
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
