import { HTTP_SERVICES, LOG_SOURCES, type LogSource } from './catalog.ts';

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

/**
 * Where a query reads a source's metrics from: `{{source:<id>}}` on a Better Stack dashboard,
 * `remote(<table>)` through the SQL query API.
 */
export type SourceRef = (source: LogSource) => string;

/** Written in Better Stack dashboard SQL: {{time}}, {{start_time}} and {{end_time}} are filled in. */
export interface ChartQuery {
  name: string;
  description: string;
  sql: (from: SourceRef) => string;
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

/** One branch per source, tagged with its name as `$service`. */
function perSource(
  from: SourceRef,
  select: string,
  where: string,
  groupBy: string,
  sources: readonly LogSource[] = LOG_SOURCES,
) {
  return sources
    .map(
      (s) =>
        `SELECT ${select.replaceAll('$service', `'${s}'`)} FROM ${from(s)} WHERE ${range} AND ${where} GROUP BY ${groupBy}`,
    )
    .join('\nUNION ALL\n');
}

const total = (from: SourceRef, where: string, sources?: readonly LogSource[]) =>
  `SELECT sum(value) AS value FROM (${perSource(from, 'sum(logs_count) AS value', where, 'tuple()', sources)})`;

/** The monitoring queries, shared by the Better Stack dashboard, the /ops page and the ops CLI. */
export const QUERIES = {
  errors: {
    name: 'Errors',
    description: 'error/fatal log lines, all services',
    sql: (from) => total(from, IS_ERROR),
  },
  http5xx: {
    name: 'HTTP 5xx responses',
    description: 'responses with status >= 500',
    sql: (from) => total(from, IS_5XX),
  },
  leadsSubmitted: {
    name: 'Leads submitted',
    description: 'lead.created',
    sql: (from) => total(from, "label('event') = 'lead.created'", ['intake']),
  },
  leadsFailed: {
    name: 'Leads failed',
    description: 'lead.failed — recover with Replay',
    sql: (from) => total(from, "label('event') = 'lead.failed'", ['intake']),
  },
  errorsByService: {
    name: 'Errors by service',
    description: 'error/fatal log lines per service',
    sql: (from) =>
      `SELECT time, series, sum(value) AS value FROM (${perSource(from, '{{time}} AS time, $service AS series, sum(logs_count) AS value', IS_ERROR, 'time')}) GROUP BY time, series`,
  },
  http5xxByService: {
    name: 'HTTP 5xx by service',
    description: 'server errors per service',
    sql: (from) =>
      `SELECT time, series, sum(value) AS value FROM (${perSource(from, `{{time}} AS time, $service AS series, sumIf(logs_count, ${IS_5XX}) AS value`, "label('status') != ''", 'time', HTTP_SERVICES)}) GROUP BY time, series`,
  },
  topErrors: {
    name: 'Top errors',
    description: 'most frequent error messages in the range',
    sql: (from) =>
      `SELECT service, event, message, sum(n) AS occurrences, max(last) AS last_seen FROM (${perSource(from, "$service AS service, label('event') AS event, label('error_message') AS message, sum(logs_count) AS n, max(dt) AS last", `${IS_ERROR} AND label('error_message') != ''`, 'event, message')}) GROUP BY service, event, message ORDER BY occurrences DESC LIMIT 20`,
  },
  p95ResponseTime: {
    name: 'p95 response time (ms)',
    description: '95th percentile request latency per service',
    sql: (from) =>
      perSource(
        from,
        '{{time}} AS time, $service AS series, round(histogramQuantile(0.95), 1) AS value',
        "name = 'response_time_ms'",
        'time',
        HTTP_SERVICES,
      ),
  },
  leadPipeline: {
    name: 'Lead pipeline',
    description:
      'Lead events: submissions, Figure outcomes, chases, replies, reviews, notices, failures',
    sql: (from) =>
      `SELECT {{time}} AS time, label('event') AS series, sum(logs_count) AS value FROM ${from('intake')} WHERE ${range} AND (label('event') LIKE 'lead.%' OR label('event') LIKE 'figure.%' OR label('event') IN ('chase.created', 'email.sent', 'email.failed', 'documents.received', 'documents.rejected', 'notice.sent', 'notice.failed')) GROUP BY time, series`,
  },
  borrowerReplies: {
    name: 'Borrower replies',
    description: 'emails received at reply+<chase>@ and what intake decided',
    sql: (from) =>
      `SELECT label('reply_outcome') AS outcome, sum(logs_count) AS replies FROM ${from('email-inbound')} WHERE ${range} AND label('reply_outcome') != '' GROUP BY outcome ORDER BY replies DESC`,
  },
  replyFailures: {
    name: 'Reply pipeline failures',
    description: 'the email Worker could not hand a reply to intake (sender retries)',
    sql: (from) =>
      `SELECT {{time}} AS time, sum(logs_count) AS value FROM ${from('email-inbound')} WHERE ${range} AND ${replyFailed} GROUP BY time`,
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
