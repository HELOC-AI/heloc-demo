/**
 * Adds the sending domain to Resend and publishes the DNS records Resend asks for
 * (DKIM, SPF, bounce MX) plus a baseline DMARC record in Cloudflare, then triggers
 * verification. Idempotent: existing domains and identical records are reused.
 *
 * Needs, in the repo-root .env:
 *   RESEND_ADMIN_API_KEY  full-access key (admin-only, never synced to a service)
 *   RESEND_DOMAIN         e.g. linkerclaw.ai (must be a zone in the Cloudflare account)
 * and a logged-in `cf` CLI (Cloudflare) for DNS writes.
 *
 *   node scripts/setup-resend-domain.ts [--wait]
 */
import { execFileSync } from 'node:child_process';
import { readRootEnv, requireVar, upsertRootEnv } from './lib/root-env.ts';

const env = readRootEnv();
const resendKey = requireVar(env, 'RESEND_ADMIN_API_KEY');
const domain = requireVar(env, 'RESEND_DOMAIN');
const DMARC = 'v=DMARC1; p=none;';

interface ResendRecord {
  record: string;
  name: string;
  type: 'TXT' | 'MX' | 'CNAME';
  value: string;
  priority?: number;
  status: string;
}
interface ResendDomain {
  id: string;
  name: string;
  status: string;
  records?: ResendRecord[];
}
interface CfRecord {
  id: string;
  type: string;
  name: string;
  content: string;
  priority?: number;
}

async function resend<T>(method: string, path: string, body?: unknown): Promise<T> {
  const response = await fetch(`https://api.resend.com${path}`, {
    method,
    headers: { authorization: `Bearer ${resendKey}`, 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Resend ${method} ${path} → ${response.status}: ${text}`);
  return JSON.parse(text) as T;
}

function cf(args: string[]): unknown {
  const out = execFileSync('cf', [...args, '--zone', domain, '--quiet'], { encoding: 'utf8' });
  return out.trim() ? JSON.parse(out) : undefined;
}

// Cloudflare stores TXT content quoted; compare without quotes.
const unquote = (s: string) => s.replace(/^"|"$/g, '');
const fqdn = (name: string) => (name === '@' || name === domain ? domain : `${name}.${domain}`);

// 1. Domain in Resend
const { data: domains } = await resend<{ data: ResendDomain[] }>('GET', '/domains');
let found = domains.find((d) => d.name === domain);
if (found) {
  console.log(`Resend: domain ${domain} exists (status ${found.status})`);
} else {
  found = await resend<ResendDomain>('POST', '/domains', { name: domain, region: 'us-east-1' });
  console.log(`Resend: domain ${domain} created`);
}
const details = await resend<ResendDomain>('GET', `/domains/${found.id}`);

// 2. DNS in Cloudflare
const wanted = [
  ...(details.records ?? []).map((r) => ({
    type: r.type,
    name: fqdn(r.name),
    content: r.value,
    priority: r.priority,
    purpose: r.record,
  })),
  { type: 'TXT', name: `_dmarc.${domain}`, content: DMARC, priority: undefined, purpose: 'DMARC' },
];
const existing = cf(['dns', 'records', 'list']) as CfRecord[];

for (const record of wanted) {
  const sameName = existing.filter((r) => r.type === record.type && r.name === record.name);
  if (sameName.some((r) => unquote(r.content) === record.content)) {
    console.log(`Cloudflare: ${record.purpose} ${record.type} ${record.name} already present`);
    continue;
  }
  if (record.purpose === 'DMARC' && sameName.length > 0) {
    console.log(`Cloudflare: keeping existing DMARC policy on ${record.name}`);
    continue;
  }
  cf([
    'dns',
    'records',
    'create',
    '--body',
    JSON.stringify({
      type: record.type,
      name: record.name,
      content: record.content,
      ttl: 1, // automatic
      proxied: false,
      ...(record.priority !== undefined && { priority: record.priority }),
      comment: `Resend (${record.purpose}) for HELOC demo`,
    }),
  ]);
  console.log(`Cloudflare: ${record.purpose} ${record.type} ${record.name} created`);
}

// 3. Verification
await resend('POST', `/domains/${found.id}/verify`);
console.log('Resend: verification triggered');

upsertRootEnv(
  { EMAIL_FROM: env.EMAIL_FROM ?? `HELOC Demo <noreply@${domain}>` },
  'Email sender (verified Resend domain)',
);

if (process.argv.includes('--wait')) {
  const deadline = Date.now() + 30 * 60_000;
  for (;;) {
    const current = await resend<ResendDomain>('GET', `/domains/${found.id}`);
    const records = (current.records ?? []).map((r) => `${r.record}=${r.status}`).join(', ');
    console.log(`${new Date().toISOString()} ${current.status} [${records}]`);
    if (current.status === 'verified') break;
    if (current.status === 'failed' || Date.now() > deadline) process.exit(1);
    await new Promise((r) => setTimeout(r, 30_000));
  }
}
