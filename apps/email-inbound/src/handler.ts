/**
 * One Inbound Email: build it, forward it to Lead Intake, log the outcome.
 *
 * Returns normally when the email is finished with — forwarded, refused by Intake (4xx), or
 * unusable (unparseable / fails the contract). Retrying those cannot help.
 * Throws when Intake is temporarily unavailable (5xx, 408, 429, network, timeout) so the Worker
 * invocation fails and the sending mail server retries later (see index.ts).
 */
import type { InboundEmail } from '@heloc/contracts';
import { domainOf } from './authentication.ts';
import { buildInboundEmail, type RawInboundMessage } from './inbound-email.ts';
import { type ForwardOutcome, IntakeUnavailableError } from './intake-client.ts';
import type { Logger } from './log.ts';

export interface HandlerDeps {
  log: Logger;
  forward: (email: InboundEmail) => Promise<ForwardOutcome>;
}

export async function handleInboundEmail(
  message: RawInboundMessage & { rawSize: number },
  deps: HandlerDeps,
): Promise<void> {
  const { log } = deps;
  const recipient = { to_subaddress: subaddressOf(message.envelopeTo), raw_size: message.rawSize };

  const built = await buildInboundEmail(message);
  if (!built.ok) {
    log.error('inbound.invalid', `dropped inbound email: ${built.reason}`, {
      ...recipient,
      issues: built.issues,
    });
    return;
  }

  const { email } = built;
  const summary = {
    ...recipient,
    message_id: email.message_id,
    from_domain: domainOf(email.from),
    dmarc: email.authentication.dmarc,
    attachment_count: email.attachments.length,
    attachment_bytes: email.attachments.reduce((sum, a) => sum + a.size, 0),
    skipped_inline: built.skippedInline,
    cloudflare_verdicts: built.cloudflareVerdicts,
  };
  log.info('inbound.received', 'inbound email received', {
    ...summary,
    authentication_detail: redactAddresses(email.authentication.detail),
  });

  let outcome: ForwardOutcome;
  try {
    outcome = await deps.forward(email);
  } catch (err) {
    log.error('inbound.forward_failed', 'intake unavailable; sender will retry', {
      ...summary,
      status: err instanceof IntakeUnavailableError ? err.status : undefined,
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }

  if (outcome.kind === 'delivered') {
    log.info('inbound.forwarded', 'inbound email forwarded to intake', {
      ...summary,
      status: outcome.status,
      accepted: outcome.response?.accepted,
      reason: outcome.response?.reason,
      lead_id: outcome.response?.lead_id,
    });
    return;
  }
  log.error('inbound.rejected_by_intake', 'intake refused inbound email; not retrying', {
    ...summary,
    status: outcome.status,
    error: outcome.error,
    error_message: outcome.message,
  });
}

/** Cloudflare's verdict names the envelope sender (`smtp.mailfrom=...`): keep domains only. */
export function redactAddresses(text: string): string {
  return text.replace(/[^\s;=()"'<>@]+@/g, '*@');
}

/** `reply+<chase_id>@linkerclaw.ai` → `<chase_id>` (an identifier, not PII). */
export function subaddressOf(address: string): string | undefined {
  const local = address.slice(0, address.lastIndexOf('@'));
  const plus = local.indexOf('+');
  return plus >= 0 ? local.slice(plus + 1) : undefined;
}
