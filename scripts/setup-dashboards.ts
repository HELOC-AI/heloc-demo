/**
 * Builds the Better Stack monitoring views for heloc-demo (idempotent):
 *   - Status page https://heloc-demo-status.betteruptime.com: health of every service
 *   - Log → metric extractions on every service's source (dashboards only read metrics)
 *   - Dashboard "HELOC operations": error statistics, HTTP health, latency, Lead pipeline
 *     and borrower-reply outcomes across all five services
 * Log alerts live in setup-betterstack.ts --alerts (explorations read raw logs).
 *
 *   node scripts/setup-dashboards.ts           # create / converge
 *   node scripts/setup-dashboards.ts --verify  # run every chart's SQL against the metrics tables
 *
 * Needs BETTER_STACK_API_KEY; --verify also needs the BETTERSTACK_QUERY_* connection.
 */
import { readRootEnv, requireVar } from './lib/root-env.ts';

const env = readRootEnv();
const token = requireVar(env, 'BETTER_STACK_API_KEY');
const TEAM = 'Your team';
const TEAM_ID = 't602815';
const DASHBOARD_NAME = 'HELOC operations';
const STATUS_SUBDOMAIN = 'heloc-demo-status';
/** Better Stack serves status pages on its betteruptime.com domain. */
const STATUS_URL = `https://${STATUS_SUBDOMAIN}.betteruptime.com`;
const SERVICES = ['intake', 'figure-mock', 'chase', 'email', 'email-inbound'] as const;
type Service = (typeof SERVICES)[number];

interface Resource {
  id: string;
  attributes: Record<string, unknown>;
}

/**
 * Fields promoted from logs to metrics at ingest time (labels = no aggregation). Dashboards
 * can only query these; they fill in from the moment they are defined (no backfill).
 * `level` is built in.
 */
const METRICS = [
  {
    name: 'event',
    type: 'string_low_cardinality',
    aggregations: [],
    sql_expression: "JSONExtract(raw, 'event', 'Nullable(String)')",
  },
  {
    name: 'status',
    type: 'string_low_cardinality',
    aggregations: [],
    sql_expression: "toString(JSONExtract(raw, 'res', 'statusCode', 'Nullable(UInt16)'))",
  },
  {
    name: 'reply_outcome',
    type: 'string_low_cardinality',
    aggregations: [],
    sql_expression:
      "if(JSONExtractString(raw, 'event') = 'inbound.forwarded', if(JSONExtractBool(raw, 'accepted'), 'accepted', JSONExtractString(raw, 'reason')), NULL)",
  },
  {
    name: 'error_message',
    type: 'string_low_cardinality',
    aggregations: [],
    sql_expression:
      "if(JSONExtractString(raw, 'level') IN ('error', 'fatal'), substring(JSONExtractString(raw, 'message'), 1, 120), NULL)",
  },
  {
    name: 'response_time_ms',
    type: 'float64_delta',
    aggregations: ['avg', 'max', 'histogram'],
    sql_expression: "JSONExtract(raw, 'responseTime', 'Nullable(Float64)')",
  },
] as const;

interface Chart {
  name: string;
  description: string;
  chart_type: 'line_chart' | 'bar_chart' | 'number_chart' | 'table_chart' | 'static_text_chart';
  x: number;
  y: number;
  w: number;
  h: number;
  /** Builds the SQL; `ids` maps service → Better Stack source id. */
  sql?: (ids: Record<Service, string>) => string;
  text?: string;
}

const range = 'dt BETWEEN {{start_time}} AND {{end_time}}';
const isError = "label('level') IN ('error', 'fatal')";

/** One branch per service over its own source ({{source:<id>}}), tagged with the service name. */
function perService(
  ids: Record<Service, string>,
  select: string,
  where: string,
  groupBy: string,
  services: readonly Service[] = SERVICES,
) {
  return services
    .map(
      (s) =>
        `SELECT ${select.replaceAll('$service', `'${s}'`)} FROM {{source:${ids[s]}}} WHERE ${range} AND ${where} GROUP BY ${groupBy}`,
    )
    .join('\nUNION ALL\n');
}

const total = (ids: Record<Service, string>, where: string, services?: readonly Service[]) =>
  `SELECT sum(value) AS value FROM (${perService(ids, 'sum(logs_count) AS value', where, 'tuple()', services)})`;

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
    sql: (ids) => total(ids, isError),
  },
  {
    name: 'HTTP 5xx responses',
    description: 'responses with status >= 500',
    chart_type: 'number_chart',
    x: 3,
    y: 0,
    w: 3,
    h: 3,
    sql: (ids) => total(ids, "toUInt16OrZero(label('status')) >= 500"),
  },
  {
    name: 'Leads submitted',
    description: 'lead.created',
    chart_type: 'number_chart',
    x: 6,
    y: 0,
    w: 3,
    h: 3,
    sql: (ids) => total(ids, "label('event') = 'lead.created'", ['intake']),
  },
  {
    name: 'Leads failed',
    description: 'lead.failed — recover with Replay',
    chart_type: 'number_chart',
    x: 9,
    y: 0,
    w: 3,
    h: 3,
    sql: (ids) => total(ids, "label('event') = 'lead.failed'", ['intake']),
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
    sql: (ids) =>
      `SELECT time, series, sum(value) AS value FROM (${perService(ids, '{{time}} AS time, $service AS series, sum(logs_count) AS value', isError, 'time')}) GROUP BY time, series`,
  },
  {
    name: 'HTTP 5xx by service',
    description: 'server errors per service',
    chart_type: 'line_chart',
    x: 6,
    y: 3,
    w: 6,
    h: 4,
    sql: (ids) =>
      `SELECT time, series, sum(value) AS value FROM (${perService(ids, "{{time}} AS time, $service AS series, sumIf(logs_count, toUInt16OrZero(label('status')) >= 500) AS value", "label('status') != ''", 'time', ['intake', 'figure-mock', 'chase', 'email'])}) GROUP BY time, series`,
  },

  // Row 3 — what is failing, and how fast things are
  {
    name: 'Top errors',
    description: 'most frequent error messages in the range',
    chart_type: 'table_chart',
    x: 0,
    y: 7,
    w: 8,
    h: 5,
    sql: (ids) =>
      `SELECT service, event, message, sum(n) AS occurrences, max(last) AS last_seen FROM (${perService(ids, "$service AS service, label('event') AS event, label('error_message') AS message, sum(logs_count) AS n, max(dt) AS last", `${isError} AND label('error_message') != ''`, 'event, message')}) GROUP BY service, event, message ORDER BY occurrences DESC LIMIT 20`,
  },
  {
    name: 'p95 response time (ms)',
    description: '95th percentile request latency per service',
    chart_type: 'line_chart',
    x: 8,
    y: 7,
    w: 4,
    h: 5,
    sql: (ids) =>
      perService(
        ids,
        '{{time}} AS time, $service AS series, round(histogramQuantile(0.95), 1) AS value',
        "name = 'response_time_ms'",
        'time',
        ['intake', 'figure-mock', 'chase', 'email'],
      ),
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
    sql: (ids) =>
      `SELECT {{time}} AS time, label('event') AS series, sum(logs_count) AS value FROM {{source:${ids.intake}}} WHERE ${range} AND (label('event') LIKE 'lead.%' OR label('event') LIKE 'figure.%' OR label('event') IN ('chase.created', 'email.sent', 'email.failed', 'documents.received', 'documents.rejected', 'notice.sent', 'notice.failed')) GROUP BY time, series`,
  },
  {
    name: 'Borrower replies',
    description: 'emails received at reply+<chase>@ and what intake decided',
    chart_type: 'table_chart',
    x: 6,
    y: 12,
    w: 3,
    h: 4,
    sql: (ids) =>
      `SELECT label('reply_outcome') AS outcome, sum(logs_count) AS replies FROM {{source:${ids['email-inbound']}}} WHERE ${range} AND label('reply_outcome') != '' GROUP BY outcome ORDER BY replies DESC`,
  },
  {
    name: 'Reply pipeline failures',
    description: 'the email Worker could not hand a reply to intake (sender retries)',
    chart_type: 'line_chart',
    x: 9,
    y: 12,
    w: 3,
    h: 4,
    sql: (ids) =>
      `SELECT {{time}} AS time, sum(logs_count) AS value FROM {{source:${ids['email-inbound']}}} WHERE ${range} AND label('event') IN ('inbound.forward_failed', 'inbound.rejected_by_intake', 'inbound.invalid') GROUP BY time`,
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
      `**Service health:** [status page](${STATUS_URL}) · **Incidents / alert history:** Uptime → Incidents · **Exceptions:** Errors → heloc-* applications · **Ops page:** https://heloc-demo.vercel.app/ops`,
      '**Alerts** (email to on-call): uptime monitors · `heloc: errors logged` · `heloc: HTTP 5xx responses` · `heloc: borrower reply pipeline failing` — recovery steps in `docs/RUNBOOK.md`. Charts read metrics extracted from logs at ingest time.',
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

async function sourceIds(): Promise<Record<Service, string>> {
  const sources = await listAll('https://telemetry.betterstack.com/api/v1/sources');
  return Object.fromEntries(
    SERVICES.map((s) => {
      const source = sources.find((x) => x.attributes.name === `heloc-${s}`);
      if (!source) throw new Error(`log source heloc-${s} missing`);
      return [s, source.id];
    }),
  ) as Record<Service, string>;
}

/** Runs each chart exactly as the dashboard would, against the metrics tables. */
async function verify() {
  const host = requireVar(env, 'BETTERSTACK_QUERY_HOST');
  const auth = Buffer.from(
    `${requireVar(env, 'BETTERSTACK_QUERY_USERNAME')}:${requireVar(env, 'BETTERSTACK_QUERY_PASSWORD')}`,
  ).toString('base64');
  const ids = await sourceIds();
  const tableFor = Object.fromEntries(
    SERVICES.map((s) => [ids[s], `remote(${TEAM_ID}_heloc_${s.replace(/-/g, '_')}_metrics_5m)`]),
  );
  let failed = 0;
  for (const chart of CHARTS.filter((c) => c.sql)) {
    const sql = chart.sql!(ids)
      .replace(/\{\{source:(\d+)\}\}/g, (_, id: string) => tableFor[id] ?? `unknown_source_${id}`)
      .replaceAll('{{time}}', 'toStartOfInterval(dt, toIntervalSecond(300))')
      .replaceAll('{{start_time}}', 'now() - INTERVAL 24 HOUR')
      .replaceAll('{{end_time}}', 'now()');
    const response = await fetch(`https://${host}?output_format_pretty_row_numbers=0`, {
      method: 'POST',
      headers: { authorization: `Basic ${auth}`, 'content-type': 'plain/text' },
      body: `${sql} FORMAT JSONEachRow`,
    });
    const text = await response.text();
    const ok = response.ok && !text.includes('"exception"') && !text.startsWith('Code:');
    if (!ok) failed++;
    const rows = ok ? text.trim().split('\n').filter(Boolean) : [];
    console.log(
      `${ok ? '✓' : '✗'} ${chart.name.padEnd(26)} ${ok ? `${rows.length} rows  ${rows.slice(0, 2).join(' ').slice(0, 150)}` : text.slice(0, 400)}`,
    );
  }
  process.exit(failed ? 1 : 0);
}

async function ensureMetrics(ids: Record<Service, string>) {
  for (const service of SERVICES) {
    const url = `https://telemetry.betterstack.com/api/v2/sources/${ids[service]}/metrics`;
    const existing = new Set((await listAll(url)).map((m) => m.attributes.name));
    const missing = METRICS.filter((m) => !existing.has(m.name));
    for (const metric of missing) await api('POST', url, metric);
    console.log(
      `metrics heloc-${service}: ${missing.length ? `added ${missing.map((m) => m.name).join(', ')}` : 'up to date'}`,
    );
  }
}

async function ensureStatusPage() {
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
  const resourcesUrl = `https://uptime.betterstack.com/api/v2/status-pages/${page.id}/resources`;
  const existing = await listAll(resourcesUrl);
  // Better Stack pre-fills a new status page with every monitor; keep only ours.
  for (const resource of existing) {
    if (!monitors.some((m) => m.id === String(resource.attributes.resource_id))) {
      await api('DELETE', `${resourcesUrl}/${resource.id}`);
      console.log(`  - removed "${String(resource.attributes.public_name)}" (not a heloc service)`);
    }
  }
  const names: [string, string][] = [
    ['heloc-web', 'Web app (quiz & results)'],
    ['heloc-intake', 'Lead Intake API'],
    ['heloc-figure-mock', 'Prequalification (Figure mock)'],
    ['heloc-chase', 'Borrower Outreach (chase)'],
    ['heloc-email', 'Email Delivery'],
  ];
  for (const [position, [monitorName, publicName]] of names.entries()) {
    const monitor = monitors.find((m) => m.attributes.pronounceable_name === monitorName);
    if (!monitor || existing.some((r) => String(r.attributes.resource_id) === monitor.id)) continue;
    await api('POST', resourcesUrl, {
      resource_id: Number(monitor.id),
      resource_type: 'Monitor',
      public_name: publicName,
      widget_type: 'history',
      position,
    });
    console.log(`  + ${publicName}`);
  }
}

async function converge() {
  await ensureStatusPage();
  const ids = await sourceIds();
  await ensureMetrics(ids);

  // Dashboard: recreate so the definition above is the single source of truth.
  for (const old of (await listAll('https://telemetry.betterstack.com/api/v2/dashboards')).filter(
    (d) => d.attributes.name === DASHBOARD_NAME,
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
    })) as { data: Resource }
  ).data;
  console.log(`dashboard "${DASHBOARD_NAME}" (id ${dashboard.id})`);

  for (const chart of CHARTS) {
    await api(
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
            : { query_type: 'sql_expression', sql_query: chart.sql!(ids) },
        ],
      },
    );
    console.log(`  chart "${chart.name}"`);
  }
}

if (process.argv.includes('--verify')) await verify();
else await converge();
