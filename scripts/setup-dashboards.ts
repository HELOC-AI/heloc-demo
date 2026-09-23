/**
 * Builds the Better Stack monitoring views for heloc-demo (idempotent):
 *   - Status page https://heloc-demo-status.betteruptime.com: health of every service
 *   - Log → metric extractions on every service's source (dashboards only read metrics)
 * Chart SQL, metric extractions and alert rules live in @heloc/ops (shared with /ops and the CLI).
 *   - Dashboard "HELOC operations": error statistics, HTTP health, latency, Lead pipeline
 *     and borrower-reply outcomes across all five services
 * Log alerts live in setup-betterstack.ts --alerts (explorations read raw logs).
 *
 *   node scripts/setup-dashboards.ts           # create / converge
 *   node scripts/setup-dashboards.ts --verify  # run every chart's SQL against the metrics tables
 *
 * Needs BETTER_STACK_API_KEY; --verify also needs the BETTERSTACK_QUERY_* connection.
 */
import {
  ALERT_RULES,
  LOG_SOURCES,
  METRICS,
  PRODUCTION_URLS,
  QUERIES,
  STATUS_PAGE_URL,
  createQueryClient,
  DASHBOARD_SOURCE,
  HTTP_SERVICES,
  DIRECT_SOURCE,
  dashboardSourceFor,
  toDirectSql,
  type LogSource,
  type QueryName,
} from '@heloc/ops';
import { readRootEnv, requireVar } from './lib/root-env.ts';

const env = readRootEnv();
const token = requireVar(env, 'BETTER_STACK_API_KEY');
const TEAM = 'Your team';
const DASHBOARD_NAME = 'HELOC operations';
const STATUS_SUBDOMAIN = 'heloc-demo-status';
const RANGE = { from: 'now-24h', to: 'now' };

interface Resource {
  id: string;
  attributes: Record<string, unknown>;
}

interface Chart {
  /** Its SQL (name and description too) comes from the shared @heloc/ops QUERIES. */
  query?: QueryName;
  name?: string;
  description?: string;
  chart_type: 'line_chart' | 'bar_chart' | 'number_chart' | 'table_chart' | 'static_text_chart';
  x: number;
  y: number;
  w: number;
  h: number;
  text?: string;
}

const CHARTS: Chart[] = [
  // Row 1 — headline numbers for the selected range
  { query: 'errors', chart_type: 'number_chart', x: 0, y: 0, w: 3, h: 3 },
  { query: 'http5xx', chart_type: 'number_chart', x: 3, y: 0, w: 3, h: 3 },
  { query: 'leadsSubmitted', chart_type: 'number_chart', x: 6, y: 0, w: 3, h: 3 },
  { query: 'leadsFailed', chart_type: 'number_chart', x: 9, y: 0, w: 3, h: 3 },
  // Row 2 — error statistics over time
  { query: 'errorsByService', chart_type: 'bar_chart', x: 0, y: 3, w: 6, h: 4 },
  { query: 'http5xxByService', chart_type: 'line_chart', x: 6, y: 3, w: 6, h: 4 },
  // Row 3 — what is failing, and how fast things are
  { query: 'topErrors', chart_type: 'table_chart', x: 0, y: 7, w: 8, h: 5 },
  { query: 'p95ResponseTime', chart_type: 'line_chart', x: 8, y: 7, w: 4, h: 5 },
  // Row 4 — business flow
  { query: 'leadPipeline', chart_type: 'bar_chart', x: 0, y: 12, w: 6, h: 4 },
  { query: 'borrowerReplies', chart_type: 'table_chart', x: 6, y: 12, w: 3, h: 4 },
  { query: 'replyFailures', chart_type: 'line_chart', x: 9, y: 12, w: 3, h: 4 },
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
      `**Service health:** [status page](${STATUS_PAGE_URL}) · **Ops page:** ${PRODUCTION_URLS.web}/ops · **Incidents / alert history:** Uptime → Incidents · **Exceptions:** Errors → heloc-* applications`,
      `**Alerts** (email to on-call): uptime monitors · ${ALERT_RULES.map((r) => `\`${r.alert}\``).join(' · ')} — recovery steps in \`docs/RUNBOOK.md\`. Charts read metrics extracted from logs at ingest time.`,
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

async function sourceIds(): Promise<Record<LogSource, string>> {
  const sources = await listAll('https://telemetry.betterstack.com/api/v1/sources');
  return Object.fromEntries(
    LOG_SOURCES.map((s) => {
      const source = sources.find((x) => x.attributes.name === `heloc-${s}`);
      if (!source) throw new Error(`log source heloc-${s} missing`);
      return [s, source.id];
    }),
  ) as Record<LogSource, string>;
}

/** Runs each chart's query as the dashboard would, against the metrics tables. */
async function verify() {
  const query = createQueryClient({
    host: requireVar(env, 'BETTERSTACK_QUERY_HOST'),
    username: requireVar(env, 'BETTERSTACK_QUERY_USERNAME'),
    password: requireVar(env, 'BETTERSTACK_QUERY_PASSWORD'),
  });
  let failed = 0;
  for (const chart of CHARTS.filter((c) => c.query)) {
    const { name, sql } = QUERIES[chart.query!];
    try {
      const rows = await query(toDirectSql(sql(DIRECT_SOURCE), { hours: 24 }));
      console.log(
        `✓ ${name.padEnd(26)} ${rows.length} rows  ${JSON.stringify(rows.slice(0, 2)).slice(0, 150)}`,
      );
    } catch (error) {
      failed++;
      console.log(`✗ ${name.padEnd(26)} ${(error as Error).message}`);
    }
  }
  const problems = await checkStoredDashboard();
  for (const problem of problems) console.log(`✗ dashboard: ${problem}`);
  if (!problems.length) console.log('✓ dashboard config: time range, source, chart columns');
  process.exit(failed || problems.length ? 1 : 0);
}

async function ensureMetrics(ids: Record<LogSource, string>) {
  for (const service of LOG_SOURCES) {
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
    console.log(`status page created: ${STATUS_PAGE_URL}`);
  } else {
    console.log(`status page exists: ${STATUS_PAGE_URL}`);
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

  // Dashboard: import it whole (variables + chart settings) and drop the previous copies, so
  // the definition above is the single source of truth.
  const previous = (await listAll('https://telemetry.betterstack.com/api/v2/dashboards')).filter(
    (d) => d.attributes.name === DASHBOARD_NAME,
  );
  await api('POST', 'https://telemetry.betterstack.com/api/v2/dashboards/import', {
    team_name: TEAM,
    data: dashboardDefinition(ids),
  });
  for (const old of previous) {
    await api('DELETE', `https://telemetry.betterstack.com/api/v2/dashboards/${old.id}`);
  }
  const dashboard = await findDashboard();
  console.log(
    `dashboard "${DASHBOARD_NAME}" imported (id ${dashboard.id}, ${CHARTS.length} charts)`,
  );
}

async function findDashboard(): Promise<Resource> {
  const found = (await listAll('https://telemetry.betterstack.com/api/v2/dashboards')).find(
    (d) => d.attributes.name === DASHBOARD_NAME,
  );
  if (!found) throw new Error(`dashboard "${DASHBOARD_NAME}" not found`);
  return found;
}

/** Per-chart display settings: which columns hold the time, the series and the values. */
function settingsFor(chart: Chart): Record<string, unknown> {
  const hasSeries = chart.query && QUERIES[chart.query].sql(DIRECT_SOURCE).includes('AS series');
  switch (chart.chart_type) {
    case 'number_chart':
      return {
        ...COLUMNS,
        series_column: '',
        unit: 'shortened',
        label: 'shown_below',
        legend: 'hidden',
        decimal_places: 0,
      };
    case 'line_chart':
    case 'bar_chart':
      return {
        ...COLUMNS,
        series_column: hasSeries ? 'series' : '',
        unit: 'shortened',
        label: 'shown_below',
        legend: hasSeries ? 'shown_below' : 'hidden',
        stacking: chart.chart_type === 'bar_chart' ? 'stack' : 'none',
        decimal_places: chart.query === 'p95ResponseTime' ? 1 : 0,
        treat_missing_values: 'zero',
      };
    default:
      return {};
  }
}
const COLUMNS = { time_column: 'time', x_axis_type: 'time', value_columns: ['value'] };

/** The dashboard in Better Stack's export / import format. */
function dashboardDefinition(ids: Record<LogSource, string>) {
  return {
    name: DASHBOARD_NAME,
    refresh_interval: 60,
    date_range_from: RANGE.from,
    date_range_to: RANGE.to,
    preset: {
      preset_type: 'implicit',
      preset_variables: [
        { name: 'start_time', variable_type: 'datetime', values: [RANGE.from] },
        { name: 'end_time', variable_type: 'datetime', values: [RANGE.to] },
        // Service charts read {{__source_union__}}: one UNION ALL over these sources' metrics.
        {
          name: 'source',
          variable_type: 'source',
          values: HTTP_SERVICES.map((s) => ids[s]),
          structured_value: {
            sourceIds: HTTP_SERVICES.map((s) => ids[s]),
            serviceIds: [],
            canonicalSourceIds: HTTP_SERVICES.map((s) => `heloc_${s.replace(/-/g, '_')}:metrics`),
          },
        },
      ],
    },
    charts: CHARTS.map((chart) => {
      const query = chart.query && QUERIES[chart.query];
      return {
        chart_type: chart.chart_type,
        name: query?.name ?? chart.name,
        description: query?.description ?? chart.description,
        x: chart.x,
        y: chart.y,
        w: chart.w,
        h: chart.h,
        settings: settingsFor(chart),
        chart_queries: query
          ? ('perService' in query
              ? HTTP_SERVICES.map((service) => query.sql(dashboardSourceFor(service)))
              : [query.sql(DASHBOARD_SOURCE)]
            ).map((sql) => ({ query_type: 'sql_expression', sql_query: sql }))
          : [{ query_type: 'static_text', static_text: chart.text }],
      };
    }),
    sections: [],
  };
}

/** What the dashboard must look like once stored, or its charts silently show no data. */
async function checkStoredDashboard(): Promise<string[]> {
  const dashboard = await findDashboard();
  const stored = (await api(
    'GET',
    `https://telemetry.betterstack.com/api/v2/dashboards/${dashboard.id}/export`,
  )) as { data?: StoredDashboard } & StoredDashboard;
  const { preset, charts } = stored.data ?? stored;
  const problems: string[] = [];
  const value = (name: string) => preset.preset_variables.find((v) => v.name === name)?.values?.[0];
  if (value('start_time') !== RANGE.from) problems.push(`start_time is ${value('start_time')}`);
  if (value('end_time') !== RANGE.to) problems.push(`end_time is ${value('end_time')}`);
  const selected = preset.preset_variables.find((v) => v.name === 'source')?.values ?? [];
  if (selected.length !== HTTP_SERVICES.length) {
    problems.push(`${selected.length}/${HTTP_SERVICES.length} sources selected`);
  }
  if (preset.preset_variables.some((v) => v.name === 'time')) {
    problems.push('a "time" variable shadows the built-in {{time}}');
  }
  if (charts.length !== CHARTS.length) problems.push(`${charts.length}/${CHARTS.length} charts`);
  for (const chart of charts) {
    if (chart.chart_type !== 'static_text_chart' && chart.chart_type !== 'table_chart') {
      if (chart.settings?.time_column !== 'time')
        problems.push(`"${chart.name}" has no time column`);
    }
    // Better Stack allows one source reference per query ("Please select a source" otherwise).
    for (const { sql_query: sql } of chart.chart_queries ?? []) {
      const refs = sql?.match(/\{\{(source[^}]*|__source_union__)\}\}/g) ?? [];
      if (sql && refs.length !== 1)
        problems.push(`"${chart.name}" has ${refs.length} source references`);
    }
  }
  return problems;
}

interface StoredDashboard {
  preset: { preset_variables: { name: string; values?: string[] }[] };
  charts: {
    name: string;
    chart_type: string;
    settings?: Record<string, unknown>;
    chart_queries?: { sql_query?: string | null }[];
  }[];
}

if (process.argv.includes('--verify')) await verify();
else await converge();
