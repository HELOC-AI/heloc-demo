import { HTTP_SERVICES, metricsTable, type LogSource } from './catalog.ts';

/**
 * Fields promoted from logs to metrics at ingest time (labels = no aggregation). Dashboards
 * and the metrics tables only know these; they fill in from the moment they are defined
 * (no backfill). `level` is built in.
 */
export const METRICS = [
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

/** Every source also labels its rows with its own service name (a constant per source). */
export const serviceMetric = (source: LogSource) => ({
  name: 'heloc_service',
  type: 'string_low_cardinality',
  aggregations: [],
  sql_expression: `'${source}'`,
});

/**
 * Where a query reads metrics from. Better Stack dashboards allow a single source reference per
 * query, so the four HTTP services are read as one union (their metrics tables share a schema),
 * and the email Worker — whose table has a different, smaller schema — on its own.
 */
export interface MetricsSource {
  /** intake, figure-mock, chase and email together. */
  services: string;
  /** The email-inbound Worker. */
  inbound: string;
  /** SQL naming the service a `services` row came from. */
  service: string;
}

/**
 * On a Better Stack dashboard: `{{__source_union__}}` is one UNION ALL over the sources selected
 * in the dashboard's source picker (the four HTTP services); rows name their service through the
 * constant `heloc_service` metric label, which fills from when it was defined.
 */
export const DASHBOARD_SOURCE: MetricsSource = {
  services: '{{__source_union__}}',
  inbound: '{{source:heloc_email_inbound:metrics}}',
  service: "ifNull(nullIf(label('heloc_service'), ''), 'unlabelled')",
};

/** Through the SQL query API: the same split, each row tagged with its service (full history). */
export const DIRECT_SOURCE: MetricsSource = {
  services: `(${HTTP_SERVICES.map((s) => `SELECT *, '${s}' AS source_service FROM ${metricsTable(s)}`).join(' UNION ALL ')})`,
  inbound: metricsTable('email-inbound'),
  service: 'source_service',
};

/** Written in Better Stack dashboard SQL: {{time}}, {{start_time}} and {{end_time}} are filled in. */
export interface ChartQuery {
  name: string;
  description: string;
  sql: (source: MetricsSource) => string;
}

const range = 'dt BETWEEN {{start_time}} AND {{end_time}}';
export const IS_ERROR = "label('level') IN ('error', 'fatal')";
export const IS_5XX = "toUInt16OrZero(label('status')) >= 500";
export const REPLY_FAILURE_EVENTS = [
  'inbound.forward_failed',
  'inbound.rejected_by_intake',
  'inbound.invalid',
] as const;
const replyFailed = `label('event') IN (${REPLY_FAILURE_EVENTS.map((e) => `'${e}'`).join(', ')})`;

/**
 * One row, even when nothing matched (sum of nothing is 0), stamped with the range end so a
 * dashboard number chart shows it as the latest point.
 */
const total = ({ services }: MetricsSource, where: string) =>
  `SELECT toDateTime({{end_time}}) AS time, sum(logs_count) AS value FROM ${services} WHERE ${range} AND ${where}`;

/** Per-service time series. */
const byService = ({ services, service }: MetricsSource, value: string, where: string) =>
  `SELECT {{time}} AS time, ${service} AS series, ${value} AS value FROM ${services} WHERE ${range} AND ${where} GROUP BY time, series ORDER BY time`;

/** The monitoring queries, shared by the Better Stack dashboard, the /ops page and the ops CLI. */
export const QUERIES = {
  errors: {
    name: 'Errors',
    description: 'error/fatal log lines of the four HTTP services (Worker: reply charts)',
    sql: (src) => total(src, IS_ERROR),
  },
  http5xx: {
    name: 'HTTP 5xx responses',
    description: 'responses with status >= 500',
    sql: (src) => total(src, IS_5XX),
  },
  leadsSubmitted: {
    name: 'Leads submitted',
    description: 'lead.created',
    sql: (src) => total(src, "label('event') = 'lead.created'"),
  },
  leadsFailed: {
    name: 'Leads failed',
    description: 'lead.failed — recover with Replay',
    sql: (src) => total(src, "label('event') = 'lead.failed'"),
  },
  errorsByService: {
    name: 'Errors by service',
    description: 'error/fatal log lines per service',
    sql: (src) => byService(src, 'sum(logs_count)', IS_ERROR),
  },
  http5xxByService: {
    name: 'HTTP 5xx by service',
    description: 'server errors per service',
    // Only HTTP request logs carry a status.
    sql: (src) => byService(src, `sumIf(logs_count, ${IS_5XX})`, "label('status') != ''"),
  },
  topErrors: {
    name: 'Top errors',
    description: 'most frequent error messages in the range',
    sql: ({ services, service }) =>
      `SELECT ${service} AS service, label('event') AS event, label('error_message') AS message, sum(logs_count) AS occurrences, max(dt) AS last_seen FROM ${services} WHERE ${range} AND ${IS_ERROR} AND label('error_message') != '' GROUP BY service, event, message ORDER BY occurrences DESC LIMIT 20`,
  },
  p95ResponseTime: {
    name: 'p95 response time (ms)',
    description: '95th percentile request latency per service',
    sql: (src) => byService(src, 'round(histogramQuantile(0.95), 1)', "name = 'response_time_ms'"),
  },
  leadPipeline: {
    name: 'Lead pipeline',
    description:
      'Lead events: submissions, Figure outcomes, chases, replies, reviews, notices, failures',
    sql: ({ services }) =>
      `SELECT {{time}} AS time, label('event') AS series, sum(logs_count) AS value FROM ${services} WHERE ${range} AND (label('event') LIKE 'lead.%' OR label('event') LIKE 'figure.%' OR label('event') IN ('chase.created', 'email.sent', 'email.failed', 'documents.received', 'documents.rejected', 'notice.sent', 'notice.failed')) GROUP BY time, series ORDER BY time`,
  },
  borrowerReplies: {
    name: 'Borrower replies',
    description: 'emails received at reply+<chase>@ and what intake decided',
    sql: ({ inbound }) =>
      `SELECT label('reply_outcome') AS outcome, sum(logs_count) AS replies FROM ${inbound} WHERE ${range} AND label('reply_outcome') != '' GROUP BY outcome ORDER BY replies DESC`,
  },
  replyFailures: {
    name: 'Reply pipeline failures',
    description: 'the email Worker could not hand a reply to intake (sender retries)',
    sql: ({ inbound }) =>
      `SELECT {{time}} AS time, sum(logs_count) AS value FROM ${inbound} WHERE ${range} AND ${replyFailed} GROUP BY time ORDER BY time`,
  },
} satisfies Record<string, ChartQuery>;
export type QueryName = keyof typeof QUERIES;

/** Turns dashboard SQL into plain ClickHouse over the last `hours`, bucketed by `bucketSeconds`. */
export function toDirectSql(
  sql: string,
  { hours, bucketSeconds = 300 }: { hours: number; bucketSeconds?: number },
): string {
  return sql
    .replaceAll('{{time}}', `toStartOfInterval(dt, toIntervalSecond(${bucketSeconds}))`)
    .replaceAll('{{start_time}}', `now() - INTERVAL ${hours} HOUR`)
    .replaceAll('{{end_time}}', 'now()');
}
