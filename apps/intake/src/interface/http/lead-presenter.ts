import type { LeadResult } from '@heloc/contracts';
import type { LeadView } from '../../application/lead-use-cases.ts';

/** Maps the Lead aggregate to the published LeadResult contract. */
export function toLeadResult({ lead, events }: LeadView): LeadResult {
  const { decision, chase } = lead;
  const lastFailure = events.findLast((e) => e.type === 'lead.failed');
  return {
    lead_id: lead.id,
    status: lead.status,
    ...(decision?.outcome === 'approved' && {
      offer: {
        lender: decision.offer.lender,
        amount: decision.offer.amount,
        apr_min: decision.offer.aprMin,
        apr_max: decision.offer.aprMax,
        term_months: decision.offer.termMonths,
        estimated_monthly_payment: decision.offer.estimatedMonthlyPayment,
        expires_at: decision.offer.expiresAt.toISOString(),
      },
    }),
    ...(decision?.outcome === 'rejected' && { reason: decision.reason }),
    ...(decision?.outcome === 'need_more_documents' && {
      documents: decision.missingDocuments as LeadResult['documents'],
    }),
    ...(chase && {
      chase: { status: chase.status, sent_at: chase.sentAt?.toISOString() ?? null },
    }),
    ...(lead.status === 'failed' &&
      lastFailure && { error: String(lastFailure.payload.reason ?? 'unknown failure') }),
    events: events.map((e) => ({
      type: e.type,
      payload: e.payload,
      created_at: e.occurredAt.toISOString(),
    })),
  };
}
