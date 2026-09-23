/** What heloc-demo runs, and where Better Stack keeps its telemetry. */

/** Backends with a public /health endpoint (Railway). */
export const HTTP_SERVICES = ['intake', 'figure-mock', 'chase', 'email'] as const;
export type HttpService = (typeof HTTP_SERVICES)[number];

/** Everything that ships logs to Better Stack (each has a source `heloc-<name>`). */
export const LOG_SOURCES = [...HTTP_SERVICES, 'email-inbound'] as const;
export type LogSource = (typeof LOG_SOURCES)[number];

export const BETTER_STACK_TEAM_ID = 't602815';
/** Better Stack serves status pages on its betteruptime.com domain. */
export const STATUS_PAGE_URL = 'https://heloc-demo-status.betteruptime.com';

const tableName = (source: LogSource) => `heloc_${source.replace(/-/g, '_')}`;

/** Recent raw log lines (hot tier: roughly the last half hour). */
export const logsTable = (source: LogSource) =>
  `remote(${BETTER_STACK_TEAM_ID}_${tableName(source)}_logs)`;

/** Older raw log lines (archive); only rows with `_row_type = 1` are log lines. */
export const archiveTable = (source: LogSource) =>
  `s3Cluster(primary, ${BETTER_STACK_TEAM_ID}_${tableName(source)}_s3)`;

/** Metrics extracted from logs at ingest time, 5-minute buckets, full retention. */
export const metricsTable = (source: LogSource) =>
  `remote(${BETTER_STACK_TEAM_ID}_${tableName(source)}_metrics_5m)`;

/** Production public URLs; override per environment (INTAKE_URL, FIGURE_URL, …). */
export const PRODUCTION_URLS = {
  web: 'https://heloc-demo.vercel.app',
  intake: 'https://intake-production-12aa.up.railway.app',
  'figure-mock': 'https://figure-mock-production.up.railway.app',
  chase: 'https://chase-production-4070.up.railway.app',
  email: 'https://email-production-48c5.up.railway.app',
} as const;
export type ServiceUrls = Record<keyof typeof PRODUCTION_URLS, string>;

const URL_VARS: Record<keyof ServiceUrls, string> = {
  web: 'WEB_URL',
  intake: 'INTAKE_URL',
  'figure-mock': 'FIGURE_URL',
  chase: 'CHASE_URL',
  email: 'EMAIL_URL',
};

/** Service URLs from INTAKE_URL / FIGURE_URL / CHASE_URL / EMAIL_URL / WEB_URL, else production. */
export function serviceUrlsFrom(env: Record<string, string | undefined>): ServiceUrls {
  return Object.fromEntries(
    Object.entries(PRODUCTION_URLS).map(([service, fallback]) => [
      service,
      (env[URL_VARS[service as keyof ServiceUrls]] || fallback).replace(/\/+$/, ''),
    ]),
  ) as ServiceUrls;
}
