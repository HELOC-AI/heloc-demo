/**
 * Post-deploy smoke test against the live services. It only exercises the approved /
 * rejected paths (forced with X-Mock-Outcome) and Replay idempotency, so it never sends a
 * Chase; the outcome emails go to Resend's test inbox (ADR-0006).
 *
 *   node scripts/smoke.ts
 *
 * URLs come from env (GitHub repository variables in CI), defaulting to production:
 *   INTAKE_URL, FIGURE_URL, CHASE_URL, EMAIL_URL, WEB_URL
 * Behind a proxy: NODE_USE_ENV_PROXY=1 HTTPS_PROXY=http://127.0.0.1:7890 node scripts/smoke.ts
 */
import { healthResponseSchema, leadResultSchema, type LeadResult } from '@heloc/contracts';

const url = (name: string, fallback: string) => (process.env[name] || fallback).replace(/\/+$/, '');
const INTAKE = url('INTAKE_URL', 'https://intake-production-12aa.up.railway.app');
const SERVICES = {
  intake: INTAKE,
  'figure-mock': url('FIGURE_URL', 'https://figure-mock-production.up.railway.app'),
  chase: url('CHASE_URL', 'https://chase-production-4070.up.railway.app'),
  email: url('EMAIL_URL', 'https://email-production-48c5.up.railway.app'),
};
const WEB = url('WEB_URL', 'https://heloc-demo.vercel.app');

let failures = 0;
async function check(name: string, fn: () => Promise<string>) {
  const started = Date.now();
  try {
    const detail = await fn();
    console.log(`✓ ${name.padEnd(42)} ${String(Date.now() - started).padStart(5)}ms  ${detail}`);
  } catch (err) {
    failures++;
    console.log(`✗ ${name.padEnd(42)} ${(err as Error).message}`);
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function post(path: string, body?: object, headers: Record<string, string> = {}) {
  const res = await fetch(`${INTAKE}${path}`, {
    method: 'POST',
    headers: {
      ...(body && { 'content-type': 'application/json' }),
      'x-request-id': `smoke-${Date.now()}`,
      ...headers,
    },
    body: body && JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  return { status: res.status, lead: leadResultSchema.parse(await res.json()) };
}

const quiz = {
  name: 'Smoke Test',
  // Resend's test inbox: the approved/rejected outcome emails really go out, but a test
  // address never bounces or hurts the sending domain's reputation.
  email: 'delivered+smoke@resend.dev',
  phone: '+14155550000',
  property_state: 'CA',
  estimated_home_value: 800_000,
  mortgage_balance: 350_000,
  credit_band: '700-739',
  income_band: '150k-200k',
  purpose: 'other',
};

for (const [service, base] of Object.entries(SERVICES)) {
  await check(`health: ${service}`, async () => {
    const res = await fetch(`${base}/health`, { signal: AbortSignal.timeout(15_000) });
    const health = healthResponseSchema.parse(await res.json());
    assert(res.ok && health.status === 'ok', `${res.status} ${JSON.stringify(health)}`);
    assert(health.service === service, `wrong service ${health.service}`);
    return `version ${health.version}${health.checks ? ` checks ${JSON.stringify(health.checks)}` : ''}`;
  });
}

await check('web: quiz page renders', async () => {
  const res = await fetch(WEB, { signal: AbortSignal.timeout(20_000) });
  const html = await res.text();
  assert(res.ok && html.includes('HELOC'), `HTTP ${res.status}`);
  return `HTTP ${res.status}`;
});

let approved: LeadResult | undefined;
await check('lead: approved path (forced)', async () => {
  const { status, lead } = await post('/v1/leads', quiz, { 'x-mock-outcome': 'approved' });
  assert(status === 201 && lead.status === 'approved' && lead.offer, `${status} ${lead.status}`);
  assert(lead.notice?.status === 'sent', `outcome email ${lead.notice?.status ?? 'missing'}`);
  approved = lead;
  return `${lead.lead_id} offer $${lead.offer.amount}, outcome email sent`;
});

await check('lead: rejected path (forced)', async () => {
  const { status, lead } = await post('/v1/leads', quiz, { 'x-mock-outcome': 'rejected' });
  assert(status === 201 && lead.status === 'rejected' && lead.reason, `${status} ${lead.status}`);
  assert(lead.notice?.status === 'sent', `outcome email ${lead.notice?.status ?? 'missing'}`);
  return `${lead.lead_id} reason ${lead.reason}, outcome email sent`;
});

await check('lead: invalid borrower data → 400', async () => {
  const res = await fetch(`${INTAKE}/v1/leads`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...quiz, email: 'not-an-email' }),
  });
  assert(res.status === 400, `HTTP ${res.status}`);
  return 'HTTP 400';
});

await check('replay: completed Lead is a no-op', async () => {
  assert(approved, 'no approved lead to replay');
  const { status, lead } = await post(`/v1/leads/${approved.lead_id}/replay`);
  const events = lead.events ?? [];
  assert(status === 200 && lead.status === 'approved', `${status} ${lead.status}`);
  assert(events.at(-1)?.type === 'lead.replayed', 'last event is not lead.replayed');
  assert(events.filter((e) => e.type === 'figure.requested').length === 1, 'soft pull re-ran');
  return 'recorded lead.replayed, nothing re-run';
});

console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exit(failures ? 1 : 0);
