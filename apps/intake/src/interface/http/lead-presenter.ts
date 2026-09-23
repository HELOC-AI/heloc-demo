import type { LeadResult, LeadStep, RejectionReason } from '@heloc/contracts';
import type { LeadView } from '../../application/lead-use-cases.ts';
import type { Offer } from '../../domain/model.ts';

/** Maps the Lead aggregate to the published LeadResult contract. */
export function toLeadResult({ lead, events }: LeadView): LeadResult {
  const { decision, chase, review, notice } = lead;
  // The final word: the Document Review when there is one, else the soft pull.
  const final = review ?? decision;
  const lastFailure = events.findLast((e) => e.type === 'lead.failed');
  const step = lead.nextStep();

  return {
    lead_id: lead.id,
    status: lead.status,
    ...(final?.outcome === 'approved' && { offer: toOfferDto(final.offer) }),
    ...(final?.outcome === 'rejected' && { reason: final.reason as RejectionReason }),
    ...(decision?.outcome === 'need_more_documents' && {
      documents: decision.missingDocuments as LeadResult['documents'],
    }),
    ...(chase && {
      chase: {
        status: chase.status,
        sent_at: chase.sentAt?.toISOString() ?? null,
        sent_to: maskEmail(lead.borrower.email),
        reply_to: chase.replyTo ?? null,
      },
    }),
    ...(chase?.reply && {
      documents_received: {
        received_at: chase.reply.receivedAt.toISOString(),
        attachments: chase.reply.attachments.map((a) => ({
          filename: a.filename,
          content_type: a.contentType,
          size: a.size,
        })),
      },
    }),
    ...(notice && {
      notice: { status: notice.status, sent_at: notice.sentAt?.toISOString() ?? null },
    }),
    ...(lead.status === 'failed' && {
      ...(lastFailure && { error: String(lastFailure.payload.reason ?? 'unknown failure') }),
      ...(step !== 'done' && { failed_step: step satisfies LeadStep }),
    }),
    events: events.map((e) => ({
      type: e.type,
      payload: e.payload,
      created_at: e.occurredAt.toISOString(),
    })),
  };
}

const toOfferDto = (offer: Offer) => ({
  lender: offer.lender,
  amount: offer.amount,
  apr_min: offer.aprMin,
  apr_max: offer.aprMax,
  term_months: offer.termMonths,
  estimated_monthly_payment: offer.estimatedMonthlyPayment,
  expires_at: offer.expiresAt.toISOString(),
});

/** `john@example.com` → `j***@example.com`: enough for the borrower to recognise it. */
export function maskEmail(email: string): string {
  const [local = '', domain = ''] = email.split('@');
  return `${local.slice(0, 1)}***@${domain}`;
}
