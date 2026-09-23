import { ALERT_RULES, ALERT_WINDOW_MINUTES, type AlertRule } from './alert-rules.ts';
import { logsTable, metricsTable, type ServiceUrls } from './catalog.ts';
import { checkHealth, type HealthCheck } from './health.ts';
import { createIntakeOpsClient, type AttentionLead } from './intake-client.ts';
import { QUERIES, toDirectSql } from './metrics.ts';
import { createQueryClient, type QueryClient, type QueryConnection } from './query-client.ts';
import { readStatusPage, type StatusPage } from './status-page.ts';

/** A part of the overview; one failing source never hides the others. */
export type Section<T> = { ok: true; data: T } | { ok: false; error: string };

async function section<T>(load: () => Promise<T>): Promise<Section<T>> {
  try {
    return { ok: true, data: await load() };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export interface AlertState {
  id: AlertRule['id'];
  alert: string;
  description: string;
  runbook: string;
  /** Matching log lines in the alert's window: > 0 means the alert is (or is about to be) firing. */
  lastWindow: number;
  firing: boolean;
  /** Matching log lines in the last 24h (5-minute resolution). */
  last24h: number;
  /** Start of the most recent 5-minute bucket with a match, if any in 24h. */
  lastSeen: string | null;
}

export interface TopError {
  service: string;
  event: string;
  message: string;
  occurrences: number;
  last_seen: string;
}

export interface Stats24h {
  errors: number;
  http5xx: number;
  leadsSubmitted: number;
  leadsFailed: number;
  topErrors: TopError[];
  /** Hourly error/fatal log lines per service. */
  errorsByHour: { time: string; series: string; value: number }[];
}

export interface Overview {
  generatedAt: string;
  health: Section<HealthCheck[]>;
  statusPage: Section<StatusPage>;
  alerts: Section<AlertState[]>;
  stats: Section<Stats24h>;
  attention: Section<AttentionLead[]>;
}

export interface OverviewConfig {
  urls: ServiceUrls;
  opsApiKey?: string | undefined;
  query?: QueryConnection | undefined;
}

const union = (rule: AlertRule, select: (source: AlertRule['sources'][number]) => string) =>
  rule.sources.map(select).join('\nUNION ALL\n');

async function alertState(query: QueryClient, rule: AlertRule): Promise<AlertState> {
  const [[live], [history]] = await Promise.all([
    query<{ n: number }>(
      `SELECT count() AS n FROM (${union(rule, (s) => `SELECT dt FROM ${logsTable(s)} WHERE dt > now() - INTERVAL ${ALERT_WINDOW_MINUTES} MINUTE AND ${rule.rawWhere}`)})`,
    ),
    query<{ total: number; last_seen: string | null }>(
      `SELECT sum(n) AS total, if(sum(n) = 0, NULL, max(last)) AS last_seen FROM (${union(rule, (s) => `SELECT sum(logs_count) AS n, max(dt) AS last FROM ${metricsTable(s)} WHERE dt > now() - INTERVAL 24 HOUR AND ${rule.metricsWhere}`)})`,
    ),
  ]);
  const lastWindow = Number(live?.n ?? 0);
  return {
    id: rule.id,
    alert: rule.alert,
    description: rule.description,
    runbook: rule.runbook,
    lastWindow,
    firing: lastWindow > 0,
    last24h: Number(history?.total ?? 0),
    lastSeen: history?.last_seen ?? null,
  };
}

async function stats24h(query: QueryClient): Promise<Stats24h> {
  const run = <Row>(name: keyof typeof QUERIES, bucketSeconds?: number) =>
    query<Row>(
      toDirectSql(QUERIES[name].sql(metricsTable), {
        hours: 24,
        ...(bucketSeconds && { bucketSeconds }),
      }),
    );
  const single = async (name: keyof typeof QUERIES) =>
    Number((await run<{ value: number | null }>(name))[0]?.value ?? 0);
  const [errors, http5xx, leadsSubmitted, leadsFailed, topErrors, errorsByHour] = await Promise.all(
    [
      single('errors'),
      single('http5xx'),
      single('leadsSubmitted'),
      single('leadsFailed'),
      run<TopError>('topErrors'),
      run<{ time: string; series: string; value: number }>('errorsByService', 3600),
    ],
  );
  return {
    errors,
    http5xx,
    leadsSubmitted,
    leadsFailed,
    topErrors: topErrors.map((e) => ({ ...e, occurrences: Number(e.occurrences) })),
    errorsByHour: errorsByHour
      .map((p) => ({ ...p, value: Number(p.value) }))
      .sort((a, b) => a.time.localeCompare(b.time)),
  };
}

const notConfigured = (what: string) => () => Promise.reject(new Error(`${what} not configured`));

/** Everything an operator looks at first, gathered in parallel. */
export async function loadOverview(
  config: OverviewConfig,
  { fetch: fetchFn = fetch } = {},
): Promise<Overview> {
  const query = config.query && createQueryClient(config.query, { fetch: fetchFn });
  const intake = createIntakeOpsClient(
    { url: config.urls.intake, opsApiKey: config.opsApiKey },
    { fetch: fetchFn },
  );
  const [health, statusPage, alerts, stats, attention] = await Promise.all([
    section(() =>
      Promise.all(
        Object.entries(config.urls).map(([service, url]) =>
          // web has no /health; its uptime monitor checks the home page too.
          checkHealth(service, url, { fetch: fetchFn, ...(service === 'web' && { path: '/' }) }),
        ),
      ),
    ),
    section(() => readStatusPage({ fetch: fetchFn })),
    section(
      query
        ? () => Promise.all(ALERT_RULES.map((rule) => alertState(query, rule)))
        : notConfigured('Better Stack query connection'),
    ),
    section(query ? () => stats24h(query) : notConfigured('Better Stack query connection')),
    section(config.opsApiKey ? () => intake.leadsNeedingAttention() : notConfigured('OPS_API_KEY')),
  ]);
  return { generatedAt: new Date().toISOString(), health, statusPage, alerts, stats, attention };
}
