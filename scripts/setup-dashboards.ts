/**
 * Builds the Better Stack monitoring + alerting views for heloc-demo (idempotent):
 *   - Status page https://heloc-demo-status.betteruptime.com: health of every service
 *   - Telemetry dashboard "HELOC operations": error statistics, HTTP health, latency,
 *     Lead pipeline and borrower-reply outcomes across all services' logs
 *   - Alerts on the dashboard's time-series charts (5xx, reply pipeline failures), next to
 *     the catch-all "heloc: errors logged" alert from setup-betterstack.ts --alerts
 *
 *   node scripts/setup-dashboards.ts           # create / converge
 *   node scripts/setup-dashboards.ts --verify  # run every chart's SQL against the log store
 *
 * Needs BETTER_STACK_API_KEY; --verify also needs the BETTERSTACK_QUERY_* connection.
 */
import { readRootEnv, requireVar } from './lib/root-env.ts';

const env = readRootEnv();
const token = requireVar(env, 'BETTER_STACK_API_KEY');
const TEAM = 'Your team';
const DASHBOARD_NAME = 'HELOC operations';
const STATUS_SUBDOMAIN = 'heloc-demo-status';
/** Better Stack serves status pages on its betteruptime.com domain. */
const STATUS_URL = `https://${STATUS_SUBDOMAIN}.betteruptime.com`;
const LOG_SOURCES = ['intake', 'figure-mock', 'chase', 'email', 'email-inbound'];

interface Resource {
  id: string;
  attributes: Record<string, unknown>;
}

interface Chart {
  name: string;
  description: string;
  chart_type: 'line_chart' | 'bar_chart' | 'number_chart' | 'table_chart' | 'static_text_chart';
  x: number;
  y: number;
  w: number;
  h: number;
  sql?: string;
  text?: string;
  /** Threshold alert on this chart (needs a {{time}} series). */
  alert?: { name: string; above: number };
}

const level = "JSONExtractString(raw, 'level')";
const event = "JSONExtractString(raw, 'event')";
const service = "JSONExtractString(raw, 'service')";
const status = "JSONExtractInt(raw, 'res', 'statusCode')";
const inRange = 'dt BETWEEN {{start_time}} AND {{end_time}}';
const timeRange = 'time BETWEEN {{start_time}} AND {{end_time}}';
const count = (where: string) =>
  `SELECT count(*) AS value FROM {{source}} WHERE ${inRange} AND ${where}`;

const CHARTS: Chart[] = [
  // Row 1 — headline numbers for the selected range
  {
    name: 'Errors',
    description: 'error/fatal log lines, all services',
    chart_type: 'number_chart',
    x: 0,
    y: 0,
    w: 3,
    h: 3,
    sql: count(`${level} IN ('error', 'fatal')`),
  },
  {
    name: 'HTTP 5xx responses',
    description: 'responses with status >= 500',
    chart_type: 'number_chart',
    x: 3,
    y: 0,
    w: 3,
    h: 3,
    sql: count(`${status} >= 500`),
  },
  {
    name: 'Leads submitted',
    description: 'lead.created',
    chart_type: 'number_chart',
    x: 6,
    y: 0,
    w: 3,
    h: 3,
    sql: count(`${event} = 'lead.created'`),
  },
  {
    name: 'Leads failed',
    description: 'lead.failed — recover with Replay',
    chart_type: 'number_chart',
    x: 9,
    y: 0,
    w: 3,
    h: 3,
    sql: count(`${event} = 'lead.failed'`),
  },

  // Row 2 — error statistics over time
  {
    name: 'Errors by service',
    description: 'error/fatal log lines per service',
    chart_type: 'bar_chart',
    x: 0,
    y: 3,
    w: 6,
    h: 4,
    sql: `SELECT {{time}} AS time, ${service} AS series, count(*) AS value FROM {{source}} WHERE ${timeRange} AND ${level} IN ('error', 'fatal') GROUP BY time, series`,
  },
  {
    name: 'HTTP 5xx by service',
    description: 'server errors per service; alert fires on any 5xx in 5 minutes',
    chart_type: 'line_chart',
    x: 6,
    y: 3,
    w: 6,
    h: 4,
    sql: `SELECT {{time}} AS time, ${service} AS series, countIf(${status} >= 500) AS value FROM {{source}} WHERE ${timeRange} AND raw LIKE '%request completed%' GROUP BY time, series`,
    alert: { name: 'heloc: HTTP 5xx responses', above: 0 },
  },

  // Row 3 — what is failing, and how fast things are
  {
    name: 'Top errors',
    description: 'most frequent error/fatal messages in the range',
    chart_type: 'table_chart',
    x: 0,
    y: 7,
    w: 8,
    h: 5,
    sql: `SELECT ${service} AS service, ${event} AS event, JSONExtractString(raw, 'message') AS message, count(*) AS occurrences, max(dt) AS last_seen FROM {{source}} WHERE ${inRange} AND ${level} IN ('error', 'fatal') GROUP BY service, event, message ORDER BY occurrences DESC LIMIT 20`,
  },
  {
    name: 'p95 response time (ms)',
    description: '95th percentile request latency per service',
    chart_type: 'line_chart',
    x: 8,
    y: 7,
    w: 4,
    h: 5,
    sql: `SELECT {{time}} AS time, ${service} AS series, round(quantile(0.95)(JSONExtractFloat(raw, 'responseTime')), 1) AS value FROM {{source}} WHERE ${timeRange} AND raw LIKE '%request completed%' GROUP BY time, series`,
  },

  // Row 4 — business flow
  {
    name: 'Lead pipeline',
    description:
      'Lead events: submissions, Figure outcomes, chases, replies, reviews, notices, failures',
    chart_type: 'bar_chart',
    x: 0,
    y: 12,
    w: 6,
    h: 4,
    sql: `SELECT {{time}} AS time, ${event} AS series, count(*) AS value FROM {{source}} WHERE ${timeRange} AND ${service} = 'intake' AND (${event} LIKE 'lead.%' OR ${event} LIKE 'figure.%' OR ${event} IN ('chase.created', 'email.sent', 'email.failed', 'documents.received', 'documents.rejected', 'notice.sent', 'notice.failed')) GROUP BY time, series`,
  },
  {
    name: 'Borrower replies',
    description: 'emails received at reply+<chase>@ and what intake decided',
    chart_type: 'table_chart',
    x: 6,
    y: 12,
    w: 3,
    h: 4,
    sql: `SELECT if(JSONExtractBool(raw, 'accepted'), 'accepted', JSONExtractString(raw, 'reason')) AS outcome, count(*) AS replies FROM {{source}} WHERE ${inRange} AND ${event} = 'inbound.forwarded' GROUP BY outcome ORDER BY replies DESC`,
  },
  {
    name: 'Reply pipeline failures',
    description: 'Worker could not hand a reply to intake (sender will retry); alert fires on any',
    chart_type: 'line_chart',
    x: 9,
    y: 12,
    w: 3,
    h: 4,
    sql: `SELECT {{time}} AS time, count(*) AS value FROM {{source}} WHERE ${timeRange} AND ${event} IN ('inbound.forward_failed', 'inbound.rejected_by_intake', 'inbound.invalid') GROUP BY time`,
    alert: { name: 'heloc: borrower reply pipeline failing', above: 0 },
  },

  // Row 5 — where to look next
  {
    name: 'Runbook links',
    description: '',
    chart_type: 'static_text_chart',
    x: 0,
    y: 16,
    w: 12,
    h: 2,
    text: [
      `**Service health:** [status page](${STATUS_URL}) · **Incidents / alert history:** Uptime → Incidents · **Exceptions:** Errors → heloc-* applications`,
      '**Alerts** (email to on-call): uptime monitors · `heloc: errors logged` · `heloc: HTTP 5xx responses` · `heloc: borrower reply pipeline failing` — recovery steps in `docs/RUNBOOK.md`',
    ].join('\n\n'),
  },
];

async function api(method: string, url: string, body?: unknown): Promise<unknown> {
  const response = await fetch(url, {
    method,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${method} ${url} → ${response.status}: ${text.slice(0, 500)}`);
  return text ? JSON.parse(text) : undefined;
}

async function listAll(url: string): Promise<Resource[]> {
  const items: Resource[] = [];
  let next: string | null = url;
  while (next) {
    const page = (await api('GET', next)) as {
      data: Resource[];
      pagination?: { next: string | null };
    };
    items.push(...page.data);
    next = page.pagination?.next ?? null;
  }
  return items;
}

async function verify() {
  const host = requireVar(env, 'BETTERSTACK_QUERY_HOST');
  const auth = Buffer.from(
    `${requireVar(env, 'BETTERSTACK_QUERY_USERNAME')}:${requireVar(env, 'BETTERSTACK_QUERY_PASSWORD')}`,
  ).toString('base64');
  const tables = LOG_SOURCES.map(
    (s) => `SELECT dt, raw FROM remote(t602815_heloc_${s.replace(/-/g, '_')}_logs)`,
  );
  let failed = 0;
  for (const chart of CHARTS.filter((c) => c.sql)) {
    const sql = chart
      .sql!.replaceAll('{{source}}', `(${tables.join(' UNION ALL ')})`)
      .replaceAll('{{time}}', 'toStartOfInterval(dt, INTERVAL 1 HOUR)')
      .replaceAll('{{start_time}}', 'now() - INTERVAL 24 HOUR')
      .replaceAll('{{end_time}}', 'now()');
    const response = await fetch(`https://${host}?output_format_pretty_row_numbers=0`, {
      method: 'POST',
      headers: { authorization: `Basic ${auth}`, 'content-type': 'plain/text' },
      body: `${sql} FORMAT JSONEachRow`,
    });
    const text = await response.text();
    const ok = response.ok && !text.includes('"exception"');
    if (!ok) failed++;
    const rows = ok ? text.trim().split('\n').filter(Boolean) : [];
    console.log(
      `${ok ? '✓' : '✗'} ${chart.name.padEnd(26)} ${ok ? `${rows.length} rows  ${rows.slice(0, 2).join(' ').slice(0, 150)}` : text.slice(0, 300)}`,
    );
  }
  process.exit(failed ? 1 : 0);
}

async function converge() {
  // Status page: service health at a glance.
  const monitors = (await listAll('https://uptime.betterstack.com/api/v2/monitors')).filter((m) =>
    /^heloc-(intake|figure-mock|chase|email|web)$/.test(String(m.attributes.pronounceable_name)),
  );
  let page = (await listAll('https://uptime.betterstack.com/api/v2/status-pages')).find(
    (p) => p.attributes.subdomain === STATUS_SUBDOMAIN,
  );
  if (!page) {
    page = (
      (await api('POST', 'https://uptime.betterstack.com/api/v2/status-pages', {
        company_name: 'HELOC Demo',
        company_url: 'https://heloc-demo.vercel.app',
        subdomain: STATUS_SUBDOMAIN,
        timezone: 'UTC',
        history: 30,
      })) as { data: Resource }
    ).data;
    console.log(`status page created: ${STATUS_URL}`);
  } else {
    console.log(`status page exists: ${STATUS_URL}`);
  }
  const existing = await listAll(
    `https://uptime.betterstack.com/api/v2/status-pages/${page.id}/resources`,
  );
  // Better Stack pre-fills a new status page with every monitor; keep only ours.
  for (const resource of existing) {
    if (!monitors.some((m) => m.id === String(resource.attributes.resource_id))) {
      await api(
        'DELETE',
        `https://uptime.betterstack.com/api/v2/status-pages/${page.id}/resources/${resource.id}`,
      );
      console.log(`  - removed "${String(resource.attributes.public_name)}" (not a heloc service)`);
    }
  }
  const order = ['heloc-web', 'heloc-intake', 'heloc-figure-mock', 'heloc-chase', 'heloc-email'];
  const names: Record<string, string> = {
    'heloc-web': 'Web app (quiz & results)',
    'heloc-intake': 'Lead Intake API',
    'heloc-figure-mock': 'Prequalification (Figure mock)',
    'heloc-chase': 'Borrower Outreach (chase)',
    'heloc-email': 'Email Delivery',
  };
  for (const [position, name] of order.entries()) {
    const monitor = monitors.find((m) => m.attributes.pronounceable_name === name);
    if (!monitor || existing.some((r) => String(r.attributes.resource_id) === monitor.id)) continue;
    await api('POST', `https://uptime.betterstack.com/api/v2/status-pages/${page.id}/resources`, {
      resource_id: Number(monitor.id),
      resource_type: 'Monitor',
      public_name: names[name],
      widget_type: 'history',
      position,
    });
    console.log(`  + ${names[name]}`);
  }

  // Dashboard: recreate so the definition above is the single source of truth.
  const sources = await listAll('https://telemetry.betterstack.com/api/v1/sources');
  const sourceIds = LOG_SOURCES.map((s) => {
    const source = sources.find((x) => x.attributes.name === `heloc-${s}`);
    if (!source) throw new Error(`log source heloc-${s} missing`);
    return source.id;
  });
  for (const old of (await listAll('https://telemetry.betterstack.com/api/v2/dashboards')).filter(
    (d) =>
      d.attributes.name === DASHBOARD_NAME || String(d.attributes.name).startsWith('heloc probe'),
  )) {
    await api('DELETE', `https://telemetry.betterstack.com/api/v2/dashboards/${old.id}`);
  }
  const dashboard = (
    (await api('POST', 'https://telemetry.betterstack.com/api/v2/dashboards', {
      name: DASHBOARD_NAME,
      team_name: TEAM,
      refresh_interval: 60,
      date_range_from: 'now-24h',
      date_range_to: 'now',
      variables: [{ name: 'source', variable_type: 'source', values: sourceIds }],
    })) as { data: Resource }
  ).data;
  console.log(`dashboard "${DASHBOARD_NAME}" (id ${dashboard.id})`);

  for (const chart of CHARTS) {
    const created = (
      (await api(
        'POST',
        `https://telemetry.betterstack.com/api/v2/dashboards/${dashboard.id}/charts`,
        {
          chart_type: chart.chart_type,
          name: chart.name,
          description: chart.description,
          x: chart.x,
          y: chart.y,
          w: chart.w,
          h: chart.h,
          queries: [
            chart.text !== undefined
              ? { query_type: 'static_text', static_text: chart.text }
              : { query_type: 'sql_expression', source_variable: 'source', sql_query: chart.sql },
          ],
        },
      )) as { data: Resource }
    ).data;
    let note = '';
    if (chart.alert) {
      await api(
        'POST',
        `https://telemetry.betterstack.com/api/v2/dashboards/${dashboard.id}/charts/${created.id}/alerts`,
        {
          name: chart.alert.name,
          alert_type: 'threshold',
          operator: 'higher_than',
          value: chart.alert.above,
          check_period: 60,
          query_period: 300,
          confirmation_period: 0,
          recovery_period: 300,
          on_missing_data: 'treat_as_zero',
          email: true,
        },
      );
      note = ` + alert "${chart.alert.name}"`;
    }
    console.log(`  chart "${chart.name}"${note}`);
  }
}

if (process.argv.includes('--verify')) await verify();
else await converge();
