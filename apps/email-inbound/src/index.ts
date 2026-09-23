/**
 * Cloudflare Email Worker: the inbound-email adapter (ADR-0004).
 *
 * Email Routing delivers `reply+<chase_id>@linkerclaw.ai` here (subaddressing on, rule for
 * `reply@linkerclaw.ai`). We turn the message into a provider-neutral Inbound Email and POST it
 * to Lead Intake; attachment contents never leave the Worker.
 *
 * Failure semantics — how the SMTP session with the sending server ends:
 * - Handler resolves → Cloudflare accepts the message (250). Used for success and for
 *   permanent problems (Intake 4xx, unparseable mail): retrying cannot fix them.
 * - Handler throws → Cloudflare answers with a *temporary* SMTP error (Email Routing logs it as
 *   "upstream (worker:…) temporary error: worker script threw an exception"), so the sending
 *   server keeps the message queued and retries with backoff (typically for up to a few days).
 *   Used when Intake is unavailable (5xx / 408 / 429 / network / 10s timeout). Not spelled out
 *   in Cloudflare's docs, but observed consistently; `setReject()` is the only documented
 *   control and it is the opposite.
 * - `message.setReject(reason)` → "Reject this email message by returning a permanent SMTP error
 *   back to the connecting client" (Cloudflare Email Workers runtime API): the sender gets a
 *   bounce and never retries. We don't use it: a bounce to a borrower for our own
 *   misconfiguration would be worse than a logged, recoverable drop.
 */
import { handleInboundEmail } from './handler.ts';
import { forwardInboundEmail } from './intake-client.ts';
import { createLogger } from './log.ts';

export interface Env {
  /** Lead Intake base URL, e.g. https://intake.example.com (wrangler.jsonc `vars`). */
  INTAKE_API_URL: string;
  /** Secret: bearer token for Intake's /v1/inbound-emails. */
  INTAKE_API_KEY: string;
  /** Secrets: Better Stack HTTP source; logging to Better Stack is skipped when unset. */
  BETTERSTACK_SOURCE_TOKEN?: string;
  BETTERSTACK_INGESTING_HOST?: string;
}

export default {
  async email(message, env, ctx): Promise<void> {
    const requestId = crypto.randomUUID();
    const log = createLogger({
      requestId,
      betterStack: {
        ingestingHost: env.BETTERSTACK_INGESTING_HOST,
        sourceToken: env.BETTERSTACK_SOURCE_TOKEN,
      },
      waitUntil: (promise) => ctx.waitUntil(promise),
    });

    await handleInboundEmail(
      {
        raw: await new Response(message.raw).arrayBuffer(),
        envelopeTo: message.to,
        rawSize: message.rawSize,
        receivedAt: new Date(),
      },
      {
        log,
        forward: (email) =>
          forwardInboundEmail(email, requestId, {
            baseUrl: env.INTAKE_API_URL,
            apiKey: env.INTAKE_API_KEY,
          }),
      },
    );
  },
} satisfies ExportedHandler<Env>;
