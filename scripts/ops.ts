/**
 * Operator CLI for heloc-demo: the same data as https://heloc-demo.vercel.app/ops, plus
 * incidents and log search (they need the local admin / query credentials).
 *
 *   pnpm ops                      # overview: health, uptime, alerts, 24h errors, Leads needing attention
 *   pnpm ops alerts               # alert rules now + recent Better Stack incidents
 *   pnpm ops errors [--hours 24]  # error statistics and top errors
 *   pnpm ops attention            # failed / stuck Leads
 *   pnpm ops lead <lead_id>       # a Lead with its event timeline
 *   pnpm ops logs <id> [--hours 24]   # log lines of every service containing a request_id / lead_id / chase id
 *   pnpm ops replay <lead_id> [--yes] # resume a failed or stuck Lead from where it stopped
 *   pnpm ops incident ack|resolve <incident_id> [--yes]
 *   pnpm ops smoke                # post-deploy smoke test (sends no email)
 *
 * Reads the repo root .env: INTAKE__OPS_API_KEY, BETTERSTACK_QUERY_*, BETTER_STACK_API_KEY.
 * Service URLs: INTAKE_URL / FIGURE_URL / CHASE_URL / EMAIL_URL / WEB_URL, else production.
 * Behind a proxy: NODE_USE_ENV_PROXY=1 HTTPS_PROXY=http://127.0.0.1:7890 pnpm ops …
 */
import { spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import { parseArgs } from 'node:util';
import {
  DIRECT_SOURCE,
  QUERIES,
  createIntakeOpsClient,
  createQueryClient,
  loadOverview,
  searchLogs,
  serviceUrlsFrom,
  toDirectSql,
  type Overview,
  type QueryConnection,
  type Section,
} from '@heloc/ops';
import { readRootEnv } from './lib/root-env.ts';

const { values: flags, positionals } = parseArgs({
  allowPositionals: true,
  options: { yes: { type: 'boolean', short: 'y' }, hours: { type: 'string' } },
});
const [command = 'status', ...args] = positionals;
const hours = Number(flags.hours ?? 24);

const env = { ...readRootEnv(), ...process.env };
const urls = serviceUrlsFrom(env);
const opsApiKey = env.INTAKE__OPS_API_KEY;
const connection: QueryConnection | undefined =
  env.BETTERSTACK_QUERY_HOST && env.BETTERSTACK_QUERY_USERNAME && env.BETTERSTACK_QUERY_PASSWORD
    ? {
        host: env.BETTERSTACK_QUERY_HOST,
        username: env.BETTERSTACK_QUERY_USERNAME,
        password: env.BETTERSTACK_QUERY_PASSWORD,
      }
    : undefined;
const intake = createIntakeOpsClient({ url: urls.intake, opsApiKey });

const color = (code: number) => (text: string) =>
  process.stdout.isTTY ? `\x1b[${code}m${text}\x1b[0m` : text;
const green = color(32);
const red = color(31);
const yellow = color(33);
const dim = color(2);
const bold = color(1);

function heading(title: string) {
  console.log(`\n${bold(title)}`);
}

function unavailable<T>(part: Section<T>): part is { ok: false; error: string } {
  if (!part.ok) console.log(`  ${yellow('unavailable:')} ${part.error}`);
  return !part.ok;
}

function queryClient() {
  if (!connection) throw new Error('BETTERSTACK_QUERY_* not set in the root .env');
  // Log search scans the archive as well as recent logs; give it longer than the /ops page gets.
  return createQueryClient(connection, { timeoutMs: 60_000 });
}

async function confirm(question: string): Promise<boolean> {
  if (flags.yes) return true;
  if (!process.stdin.isTTY) throw new Error(`${question} — pass --yes to confirm`);
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(`${question} [y/N] `);
  rl.close();
  return /^y(es)?$/i.test(answer.trim());
}

async function betterStack(method: string, path: string): Promise<unknown> {
  const token = env.BETTER_STACK_API_KEY;
  if (!token) throw new Error('BETTER_STACK_API_KEY not set in the root .env');
  const response = await fetch(`https://uptime.betterstack.com${path}`, {
    method,
    headers: { authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(15_000),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${method} ${path} → HTTP ${response.status}`);
  return text ? JSON.parse(text) : undefined;
}

async function status() {
  const overview = await loadOverview({ urls, opsApiKey, query: connection });

  heading('Service health');
  if (!unavailable(overview.health)) {
    for (const h of overview.health.data) {
      const checks = h.checks
        ? ` ${Object.entries(h.checks)
            .map(([k, v]) => `${k}:${v}`)
            .join(' ')}`
        : '';
      console.log(
        `  ${h.ok ? green('●') : red('●')} ${h.service.padEnd(12)} ${String(h.httpStatus ?? '—').padEnd(4)} ${`${h.latencyMs}ms`.padStart(7)}  ${h.version ?? ''}${checks}${h.error ? `  ${red(h.error)}` : ''}`,
      );
    }
  }

  heading('Uptime (status page, 30 days)');
  if (!unavailable(overview.statusPage)) {
    const page = overview.statusPage.data;
    console.log(`  overall: ${page.state === 'operational' ? green(page.state) : red(page.state)}`);
    for (const r of page.resources) {
      const incidents = r.history.filter((d) => d.status === 'downtime' || d.status === 'degraded');
      console.log(
        `  ${r.name.padEnd(32)} ${(r.availability * 100).toFixed(3).padStart(7)}%  ${r.status}${incidents.length ? dim(`  (${incidents.length} day(s) with downtime)`) : ''}`,
      );
    }
    console.log(dim(`  ${page.url}`));
  }

  heading('Alerts');
  if (!unavailable(overview.alerts)) {
    for (const a of overview.alerts.data) {
      console.log(
        `  ${a.firing ? red('FIRING') : green('quiet ')} ${a.alert.padEnd(40)} last 5m: ${a.lastWindow}  24h: ${a.last24h}${a.lastSeen ? dim(`  last ${a.lastSeen.slice(0, 16)} UTC`) : ''}`,
      );
    }
  }

  heading('Last 24 hours');
  if (!unavailable(overview.stats)) {
    const s = overview.stats.data;
    console.log(
      `  errors ${s.errors}  ·  HTTP 5xx ${s.http5xx}  ·  Leads submitted ${s.leadsSubmitted}  ·  Leads failed ${s.leadsFailed}`,
    );
    for (const e of s.topErrors.slice(0, 5)) {
      console.log(`  ${String(e.occurrences).padStart(4)}× ${e.service.padEnd(13)} ${e.message}`);
    }
  }

  printAttention(overview.attention);
}

function printAttention(attention: Overview['attention']) {
  heading('Leads needing attention');
  if (!unavailable(attention)) {
    if (!attention.data.length) console.log(`  ${green('none')}`);
    for (const lead of attention.data) {
      console.log(
        `  ${lead.lead_id}  ${(lead.status === 'failed' ? red : yellow)(lead.status.padEnd(18))} ${lead.failed_step ?? ''}  ${dim(lead.updated_at)}${lead.error ? `\n    ${lead.error}` : ''}`,
      );
    }
    if (attention.data.length) console.log(dim('  → pnpm ops replay <lead_id>'));
  }
}

async function attention() {
  const leads = await intake.leadsNeedingAttention().then(
    (data) => ({ ok: true, data }) as const,
    (error: Error) => ({ ok: false, error: error.message }) as const,
  );
  printAttention(leads);
}

async function alerts() {
  await status();
  heading('Recent incidents (Better Stack)');
  const { data } = (await betterStack('GET', '/api/v3/incidents?per_page=15')) as {
    data: { id: string; attributes: Record<string, string | null> }[];
  };
  for (const { id, attributes: i } of data) {
    const state = i.resolved_at
      ? green('resolved')
      : i.acknowledged_at
        ? yellow('acknowledged')
        : red('OPEN');
    console.log(
      `  ${id}  ${state.padEnd(12)} ${String(i.started_at).slice(0, 16)}  ${i.name}\n    ${dim(String(i.cause))}`,
    );
  }
}

async function errors() {
  const query = queryClient();
  const run = (name: keyof typeof QUERIES, bucketSeconds?: number) =>
    query<Record<string, string | number>>(
      toDirectSql(QUERIES[name].sql(DIRECT_SOURCE), {
        hours,
        ...(bucketSeconds && { bucketSeconds }),
      }),
    );
  const [byService, top] = await Promise.all([run('errorsByService', 3600), run('topErrors')]);
  heading(`Errors by service and hour (last ${hours}h)`);
  for (const p of byService.sort((a, b) => String(a.time).localeCompare(String(b.time)))) {
    console.log(`  ${String(p.time).slice(0, 16)}  ${String(p.series).padEnd(14)} ${p.value}`);
  }
  heading('Top errors');
  for (const e of top) {
    console.log(
      `  ${String(e.occurrences).padStart(4)}× ${String(e.service).padEnd(13)} ${String(e.event).padEnd(22)} ${e.message}  ${dim(String(e.last_seen).slice(0, 16))}`,
    );
  }
  if (!byService.length) console.log(`  ${green('no errors')}`);
}

async function lead(leadId: string | undefined) {
  if (!leadId) throw new Error('usage: pnpm ops lead <lead_id>');
  const result = await intake.lead(leadId);
  if (!result) throw new Error(`Lead ${leadId} not found`);
  const { events, ...rest } = result;
  console.log(JSON.stringify(rest, null, 2));
  heading('Timeline');
  for (const e of events ?? []) console.log(`  ${e.created_at}  ${e.type}`);
  console.log(dim(`\n  ${urls.web}/result/${leadId} · pnpm ops logs ${leadId}`));
}

async function logs(term: string | undefined) {
  if (!term) throw new Error('usage: pnpm ops logs <request_id | lead_id | chase_id>');
  const lines = await searchLogs(queryClient(), term, { hours });
  for (const l of lines) {
    const level = l.level === 'error' || l.level === 'fatal' ? red(l.level) : l.level;
    console.log(
      `  ${l.dt.slice(0, 23)}  ${l.source.padEnd(13)} ${level.padEnd(5)} ${l.event || l.message}${l.status ? ` ${l.status}` : ''}`,
    );
  }
  if (!lines.length) console.log(`  no log lines contain ${term} in the last ${hours}h`);
}

/** Mid-pipeline statuses: a Lead left in one of them for minutes was interrupted. */
const STUCK_STATUSES = new Set(['submitted', 'processing', 'documents_received']);

async function replay(leadId: string | undefined) {
  if (!leadId) throw new Error('usage: pnpm ops replay <lead_id>');
  const current = await intake.lead(leadId);
  if (!current) throw new Error(`Lead ${leadId} not found`);
  console.log(
    `Lead ${leadId}: ${current.status}${current.failed_step ? ` at ${current.failed_step}` : ''}`,
  );
  const question =
    current.status === 'failed'
      ? `Replay from ${current.failed_step}?`
      : STUCK_STATUSES.has(current.status)
        ? `It may still be in progress (${current.status}); replay only if it is stuck. Replay?`
        : undefined;
  if (!question) {
    console.log('Nothing to resume: the Lead is waiting on the borrower or finished.');
    return;
  }
  if (!(await confirm(question))) return;
  const { status: http, body } = await intake.replay(leadId);
  const after = body as { status?: string; error?: string };
  console.log(
    `HTTP ${http} → ${after.status ?? JSON.stringify(body)}${after.error ? ` (${after.error})` : ''}`,
  );
}

async function incident(action: string | undefined, id: string | undefined) {
  if ((action !== 'ack' && action !== 'resolve') || !id || !/^\d+$/.test(id)) {
    throw new Error('usage: pnpm ops incident ack|resolve <incident_id>');
  }
  if (!(await confirm(`${action === 'ack' ? 'Acknowledge' : 'Resolve'} incident ${id}?`))) return;
  await betterStack(
    'POST',
    `/api/v3/incidents/${id}/${action === 'ack' ? 'acknowledge' : 'resolve'}`,
  );
  console.log(`incident ${id}: ${action === 'ack' ? 'acknowledged' : 'resolved'}`);
}

const commands: Record<string, () => Promise<void>> = {
  status,
  alerts,
  errors,
  attention,
  lead: () => lead(args[0]),
  logs: () => logs(args[0]),
  replay: () => replay(args[0]),
  incident: () => incident(args[0], args[1]),
  smoke: async () => {
    const run = spawnSync(process.execPath, ['scripts/smoke.ts'], { stdio: 'inherit' });
    process.exitCode = run.status ?? 1;
  },
};

const run = commands[command];
if (!run) {
  console.error(`unknown command "${command}"; one of: ${Object.keys(commands).join(', ')}`);
  process.exit(2);
}
try {
  await run();
} catch (error) {
  console.error(red((error as Error).message));
  process.exitCode = 1;
}
