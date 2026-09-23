import type {
  CreditBand,
  DocumentType,
  IncomeBand,
  LeadEventType,
  LeadResult,
  LeadStatus,
  MockOutcome,
  Purpose,
  UsState,
} from '@heloc/contracts';
import { formatUsd } from './format.ts';
import { MIN_LINE } from './money.ts';

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

const REJECTION_REASONS: Record<string, Explanation> = {
  insufficient_home_equity: {
    title: 'Not enough available home equity',
    body:
      `Lenders typically let you borrow up to 85% of your home's value, minus what you still owe. ` +
      `Based on the numbers you shared, that leaves less than the ${formatUsd(MIN_LINE)} minimum line.`,
  },
  credit_below_minimum: {
    title: 'Credit range below our minimum',
    body:
      'The credit range you selected is below the minimum for this product. ' +
      'As your credit improves, you are welcome to check again.',
  },
};

/** Why a Lead was Rejected, in plain words; unknown reason codes get a generic message. */
export function rejectionExplanation(reason: string | undefined): Explanation {
  return (
    (reason && REJECTION_REASONS[reason]) || {
      title: 'We could not prequalify you right now',
      body: 'Based on the information you provided, we are unable to offer a home equity line at this time.',
    }
  );
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
};

type LeadEvent = NonNullable<LeadResult['events']>[number];

/** A short, optional detail line for a timeline entry, derived from the event payload. */
export function eventDetail({ type, payload }: LeadEvent): string | undefined {
  const text = (value: unknown) => (typeof value === 'string' && value !== '' ? value : undefined);
  switch (type) {
    case 'figure.approved':
      return typeof payload.amount === 'number'
        ? `Line up to ${formatUsd(payload.amount)}`
        : undefined;
    case 'figure.rejected':
      return text(payload.reason) && rejectionExplanation(text(payload.reason)).title;
    case 'figure.need_more_documents':
      return Array.isArray(payload.documents)
        ? payload.documents.map((d) => documentLabel(String(d))).join(', ')
        : undefined;
    case 'lead.failed':
    case 'email.failed':
      return text(payload.reason);
    case 'lead.replayed': {
      const from = text(payload.from_status);
      return from ? `Resumed from “${from.replaceAll('_', ' ')}”` : undefined;
    }
    default:
      return undefined;
  }
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
  failed: 'Needs attention',
};
