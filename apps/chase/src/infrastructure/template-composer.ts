import type { Composer } from '../application/send-chase.ts';
import { firstName, type Chase, type ChaseMessage } from '../domain/chase.ts';

export const SUBJECT = 'Additional documents required for your HELOC application';

/** Deterministic template (spec §11.3); swap for an LlmComposer behind the same port. */
export class TemplateComposer implements Composer {
  compose(chase: Chase): ChaseMessage {
    const name = firstName(chase.borrower);
    const reason = (r: string) => (/[.!?]$/.test(r) ? r : `${r}.`);

    const text = [
      `Hi ${name},`,
      '',
      'We need a few additional documents to continue processing your HELOC application.',
      '',
      'Please provide:',
      '',
      ...chase.requests.map((d) => `- ${d.label}\n  Reason: ${reason(d.reason)}`),
      '',
      'Thanks.',
    ].join('\n');

    const html = `<!doctype html>
<html>
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
    <p>Thanks.</p>
  </body>
</html>`;

    return { subject: SUBJECT, text, html };
  }
}

const escape = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
