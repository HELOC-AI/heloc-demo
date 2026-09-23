import {
  HELOC_LIMITS,
  REJECTION_REASONS,
  type CreditBand,
  type DocumentType,
  type IncomeBand,
  type LeadEventType,
  type LeadResult,
  type LeadStatus,
  type LeadStep,
  type MockOutcome,
  type Purpose,
  type RejectionReason,
  type UsState,
} from '@heloc/contracts';
import { formatUsd } from './format.ts';

/** Borrower-facing labels for the contract's enums. Records keep them exhaustive. */

export const STATE_NAMES: Record<UsState, string> = {
  AL: 'Alabama',
  AK: 'Alaska',
  AZ: 'Arizona',
  AR: 'Arkansas',
  CA: 'California',
  CO: 'Colorado',
  CT: 'Connecticut',
  DE: 'Delaware',
  DC: 'District of Columbia',
  FL: 'Florida',
  GA: 'Georgia',
  HI: 'Hawaii',
  ID: 'Idaho',
  IL: 'Illinois',
  IN: 'Indiana',
  IA: 'Iowa',
  KS: 'Kansas',
  KY: 'Kentucky',
  LA: 'Louisiana',
  ME: 'Maine',
  MD: 'Maryland',
  MA: 'Massachusetts',
  MI: 'Michigan',
  MN: 'Minnesota',
  MS: 'Mississippi',
  MO: 'Missouri',
  MT: 'Montana',
  NE: 'Nebraska',
  NV: 'Nevada',
  NH: 'New Hampshire',
  NJ: 'New Jersey',
  NM: 'New Mexico',
  NY: 'New York',
  NC: 'North Carolina',
  ND: 'North Dakota',
  OH: 'Ohio',
  OK: 'Oklahoma',
  OR: 'Oregon',
  PA: 'Pennsylvania',
  RI: 'Rhode Island',
  SC: 'South Carolina',
  SD: 'South Dakota',
  TN: 'Tennessee',
  TX: 'Texas',
  UT: 'Utah',
  VT: 'Vermont',
  VA: 'Virginia',
  WA: 'Washington',
  WV: 'West Virginia',
  WI: 'Wisconsin',
  WY: 'Wyoming',
};

export const CREDIT_BAND_LABELS: Record<CreditBand, string> = {
  '<580': 'Below 580',
  '580-619': '580 – 619',
  '620-659': '620 – 659',
  '660-699': '660 – 699',
  '700-739': '700 – 739',
  '740-779': '740 – 779',
  '780+': '780 or higher',
};

export const INCOME_BAND_LABELS: Record<IncomeBand, string> = {
  '<50k': 'Under $50,000',
  '50k-100k': '$50,000 – $100,000',
  '100k-150k': '$100,000 – $150,000',
  '150k-200k': '$150,000 – $200,000',
  '200k-300k': '$200,000 – $300,000',
  '300k+': '$300,000 or more',
};

export const PURPOSE_LABELS: Record<Purpose, string> = {
  home_improvement: 'Home improvement',
  debt_consolidation: 'Debt consolidation',
  education: 'Education',
  major_purchase: 'Major purchase',
  emergency_fund: 'Emergency fund',
  other: 'Something else',
};

export const MOCK_OUTCOME_LABELS: Record<MockOutcome, string> = {
  approved: 'Approved',
  rejected: 'Rejected',
  'need-more-documents': 'Need more documents',
};

export const DOCUMENT_LABELS: Record<DocumentType, string> = {
  income_verification: 'Proof of income',
  employment_verification: 'Proof of employment',
  mortgage_statement: 'Your most recent mortgage statement',
  property_valuation: 'A recent home appraisal or valuation',
  identity_verification: 'A government-issued photo ID',
};

export interface Explanation {
  title: string;
  body: string;
}

const { maxCombinedLtv, minLine } = HELOC_LIMITS;

const REJECTION_EXPLANATIONS: Record<RejectionReason, Explanation> = {
  insufficient_home_equity: {
    title: 'Not enough available home equity',
    body:
      `Lenders typically let you borrow up to ${Math.round(maxCombinedLtv * 100)}% of your home's value, minus what you still owe. ` +
      `Based on the numbers you shared, that leaves less than the ${formatUsd(minLine)} minimum line.`,
  },
  credit_below_minimum: {
    title: 'Credit range below our minimum',
    body:
      'The credit range you selected is below the minimum for this product. ' +
      'As your credit improves, you are welcome to check again.',
  },
};

const GENERIC_REJECTION: Explanation = {
  title: 'We could not prequalify you right now',
  body: 'Based on the information you provided, we are unable to offer a home equity line at this time.',
};

export function isRejectionReason(value: unknown): value is RejectionReason {
  return (REJECTION_REASONS as readonly unknown[]).includes(value);
}

/** Why a Lead was Rejected, in plain words; a Lead without a reason gets a generic message. */
export function rejectionExplanation(reason: RejectionReason | undefined): Explanation {
  return reason ? REJECTION_EXPLANATIONS[reason] : GENERIC_REJECTION;
}

/** What went wrong, per the step Replay resumes from. */
export const FAILURE_COPY: Record<LeadStep, Explanation> = {
  prequalify: {
    title: "We couldn't complete your credit check",
    body: "Your application is saved. Try again and we'll pick up right where we left off; you won't need to re-enter anything.",
  },
  chase: {
    title: "We couldn't send the documents request email",
    body: "Your application is saved and we know which documents we need. Try again and we'll resend the email.",
  },
  review: {
    title: "We couldn't finish reviewing your documents",
    body: "We have your documents, so there's no need to send them again. Try again and we'll finish the review.",
  },
  notify: {
    title: "Your result is ready but we couldn't email it",
    body: "Your result is below. Try again and we'll send you a copy by email.",
  },
};

const GENERIC_FAILURE: Explanation = {
  title: 'We hit a snag checking your options',
  body: FAILURE_COPY.prequalify.body,
};

/** Borrower-facing copy for a `failed` Lead; older Leads may not say which step failed. */
export function failureCopy(step: LeadStep | undefined): Explanation {
  return step ? FAILURE_COPY[step] : GENERIC_FAILURE;
}

export const EVENT_LABELS: Record<LeadEventType, string> = {
  'lead.created': 'Application received',
  'lead.replayed': 'Replayed',
  'lead.failed': 'Processing interrupted',
  'figure.requested': 'Soft credit check requested',
  'figure.approved': 'Prequalified with an offer',
  'figure.rejected': 'Not prequalified',
  'figure.need_more_documents': 'Documents requested',
  'chase.created': 'Document checklist prepared',
  'email.sent': 'Email sent',
  'email.failed': 'Email could not be sent',
  'documents.received': 'Documents received',
  'documents.rejected': 'Reply not accepted',
  'figure.review_requested': 'Documents sent to Figure for review',
  'figure.review_approved': 'Approved after review',
  'figure.review_rejected': 'Declined after review',
  'notice.created': 'Result email prepared',
  'notice.sent': 'Result email sent',
  'notice.failed': 'Result email failed',
};

/** Events worth flagging in the timeline: something failed or was refused. */
const PROBLEM_EVENTS: ReadonlySet<LeadEventType> = new Set([
  'lead.failed',
  'email.failed',
  'documents.rejected',
  'notice.failed',
]);

export function isProblemEvent(type: LeadEventType): boolean {
  return PROBLEM_EVENTS.has(type);
}

type LeadEvent = NonNullable<LeadResult['events']>[number];

/** A short, optional detail line for a timeline entry, derived from the event payload. */
export function eventDetail({ type, payload }: LeadEvent): string | undefined {
  switch (type) {
    case 'figure.approved':
    case 'figure.review_approved':
      return typeof payload.amount === 'number'
        ? `Line up to ${formatUsd(payload.amount)}`
        : undefined;
    case 'figure.rejected':
    case 'figure.review_rejected':
      if (isRejectionReason(payload.reason)) return rejectionExplanation(payload.reason).title;
      return readable(text(payload.reason));
    case 'figure.need_more_documents':
      return Array.isArray(payload.documents)
        ? payload.documents.map((d) => documentLabel(String(d))).join(', ')
        : undefined;
    case 'documents.received':
    case 'figure.review_requested':
      return attachmentSummary(payload.attachments);
    case 'documents.rejected':
      return readable(text(payload.reason));
    case 'lead.failed':
    case 'email.failed':
    case 'notice.failed':
      return text(payload.reason);
    case 'lead.replayed': {
      const from = text(payload.from_status);
      return from ? `Resumed from “${from.replaceAll('_', ' ')}”` : undefined;
    }
    default:
      return undefined;
  }
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}

/** "3 attachments: a.pdf, b.pdf, c.jpg" from a payload's attachment list (or count). */
function attachmentSummary(attachments: unknown): string | undefined {
  if (typeof attachments === 'number') return pluralize(attachments, 'attachment');
  if (!Array.isArray(attachments) || attachments.length === 0) return undefined;
  const names = attachments
    .map((a: unknown) =>
      typeof a === 'object' && a !== null ? text((a as { filename?: unknown }).filename) : text(a),
    )
    .filter((name): name is string => name !== undefined);
  const count = pluralize(attachments.length, 'attachment');
  return names.length > 0 ? `${count}: ${names.join(', ')}` : count;
}

function pluralize(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

/** Reason codes ("sender_mismatch") read as words; free text passes through. */
function readable(reason: string | undefined): string | undefined {
  if (reason === undefined) return undefined;
  return /^[a-z0-9]+(_[a-z0-9]+)+$/.test(reason) ? humanize(reason) : reason;
}

export function documentLabel(type: string): string {
  return DOCUMENT_LABELS[type as DocumentType] ?? humanize(type);
}

function humanize(code: string): string {
  const words = code.replaceAll('_', ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Short status for the result page's badge. */
export const STATUS_LABELS: Record<LeadStatus, string> = {
  submitted: 'In progress',
  processing: 'In progress',
  approved: 'Prequalified',
  rejected: 'Not prequalified',
  need_more_documents: 'Documents needed',
  chase_sent: 'Documents needed',
  documents_received: 'Under review',
  failed: 'Needs attention',
};
