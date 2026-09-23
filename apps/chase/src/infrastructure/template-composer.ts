import type { Composer } from '../application/send-chase.ts';
import {
  firstName,
  REJECTION_EXPLANATIONS,
  type Chase,
  type ChaseMessage,
  type OutcomeNotice,
} from '../domain/chase.ts';

export const SUBJECT = 'Additional documents required for your HELOC application';
export const APPROVED_SUBJECT = 'Your HELOC offer is ready';
export const REJECTED_SUBJECT = 'An update on your HELOC application';

/** Deterministic template (spec §11.3); swap for an LlmComposer behind the same port. */
export class TemplateComposer implements Composer {
  composeOutcome(notice: OutcomeNotice): ChaseMessage {
    return composeOutcome(notice);
  }

  compose(chase: Chase): ChaseMessage {
    const name = firstName(chase.borrower);
    const reason = (r: string) => (/[.!?]$/.test(r) ? r : `${r}.`);
    const replyHref = replyMailto(chase);

    const text = [
      `Hi ${name},`,
      '',
      'We need a few additional documents to continue processing your HELOC application.',
      '',
      'Please provide:',
      '',
      ...chase.requests.map((d) => `- ${d.label}\n  Reason: ${reason(d.reason)}`),
      '',
      'Just reply to this email and attach the documents — we will pick them up automatically.',
      `(Or send them to ${chase.replyAddress}.)`,
      '',
      'Thanks.',
    ].join('\n');

    const html = `<!doctype html>
<html>
  <head><meta charset="utf-8" /></head>
  <body style="font-family: -apple-system, Segoe UI, Roboto, sans-serif; color: #0f172a; line-height: 1.5;">
    <p>Hi ${escape(name)},</p>
    <p>We need a few additional documents to continue processing your HELOC application.</p>
    <p>Please provide:</p>
    <ul>
${chase.requests
  .map(
    (d) =>
      `      <li><strong>${escape(d.label)}</strong><br />Reason: ${escape(reason(d.reason))}</li>`,
  )
  .join('\n')}
    </ul>
    <p>Just reply to this email and attach the documents — we will pick them up automatically.</p>
    ${replyButton(replyHref, 'Reply with documents')}
    <p style="font-size: 13px; color: #64748b;">
      The button opens a reply addressed to
      <a href="${escape(replyHref)}" style="color: #2563eb;">${escape(chase.replyAddress)}</a>;
      attach your documents and send. Your email app's Reply button works too.
    </p>
    <p>Thanks.</p>
  </body>
</html>`;

    return { subject: SUBJECT, text, html };
  }
}

export function composeOutcome(notice: OutcomeNotice): ChaseMessage {
  const name = firstName(notice.borrower);
  const usd = (n: number) =>
    new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: 0,
    }).format(n);
  const date = (d: Date) =>
    new Intl.DateTimeFormat('en-US', { dateStyle: 'long', timeZone: 'UTC' }).format(d);

  if (notice.outcome.status === 'approved') {
    const o = notice.outcome.offer;
    const lines = [
      `Credit line: ${usd(o.amount)}`,
      `APR: ${o.aprMin}% – ${o.aprMax}%`,
      `Term: ${o.termMonths / 12} years`,
      `Estimated monthly payment: ${usd(o.estimatedMonthlyPayment)}`,
      `Offer valid until: ${date(o.expiresAt)}`,
    ];
    const text = [
      `Hi ${name},`,
      '',
      'Thanks for sending your documents. We have reviewed them and your HELOC offer is ready:',
      '',
      ...lines.map((l) => `- ${l}`),
      '',
      `View your offer: ${notice.resultUrl}`,
      '',
      'Thanks.',
    ].join('\n');
    const html = wrap(`
    <p>Hi ${escape(name)},</p>
    <p>Thanks for sending your documents. We have reviewed them and your HELOC offer is ready:</p>
    <ul>
${lines.map((l) => `      <li>${escape(l)}</li>`).join('\n')}
    </ul>
    <p><a href="${escape(notice.resultUrl)}">View your offer</a></p>
    <p>Thanks.</p>`);
    return { subject: APPROVED_SUBJECT, text, html };
  }

  const why = REJECTION_EXPLANATIONS[notice.outcome.reason];
  const text = [
    `Hi ${name},`,
    '',
    `Thanks for sending your documents. After reviewing them, we are unable to offer you a HELOC at this time because ${why}.`,
    '',
    `Details: ${notice.resultUrl}`,
    '',
    'Thanks.',
  ].join('\n');
  const html = wrap(`
    <p>Hi ${escape(name)},</p>
    <p>Thanks for sending your documents. After reviewing them, we are unable to offer you a HELOC at this time because ${escape(why)}.</p>
    <p><a href="${escape(notice.resultUrl)}">See details</a></p>
    <p>Thanks.</p>`);
  return { subject: REJECTED_SUBJECT, text, html };
}

/**
 * A `mailto:` quick reply: email clients strip scripts and forms, so a pre-addressed
 * reply is the one "reply" action every client supports. The borrower only attaches files.
 */
export function replyMailto(chase: Chase): string {
  const params = new URLSearchParams({
    subject: `Re: ${SUBJECT}`,
    body: 'Hi,\n\nPlease find my documents attached.\n\nThanks',
  });
  // mailto wants %20 rather than + for spaces.
  return `mailto:${chase.replyAddress}?${params.toString().replace(/\+/g, '%20')}`;
}

/** Table-based button: Outlook ignores padding on links, so the cell carries the shape. */
function replyButton(href: string, label: string): string {
  return `<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin: 24px 0;">
      <tr>
        <td align="center" bgcolor="#2563eb" style="border-radius: 8px;">
          <a href="${escape(href)}" target="_blank" style="display: inline-block; padding: 12px 24px; font-size: 16px; font-weight: 600; color: #ffffff; text-decoration: none; border-radius: 8px;">${escape(label)}</a>
        </td>
      </tr>
    </table>`;
}

const wrap = (body: string) => `<!doctype html>
<html>
  <head><meta charset="utf-8" /></head>
  <body style="font-family: -apple-system, Segoe UI, Roboto, sans-serif; color: #0f172a; line-height: 1.5;">${body}
  </body>
</html>`;

const escape = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
