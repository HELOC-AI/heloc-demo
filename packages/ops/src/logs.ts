import { LOG_SOURCES, archiveTable, logsTable } from './catalog.ts';
import type { QueryClient } from './query-client.ts';

export interface LogLine {
  dt: string;
  source: string;
  level: string;
  event: string;
  message: string;
  status: string;
  raw: string;
}

/** Ids are pasted into SQL: allow only what request ids, Lead ids and chase ids look like. */
const SEARCH_TERM = /^[A-Za-z0-9._:@+-]{6,100}$/;

/**
 * Log lines from every source containing `term` (a request_id, lead_id, chase id…) within the
 * last `hours`, oldest first — recent logs and the archive together.
 */
export async function searchLogs(
  query: QueryClient,
  term: string,
  { hours = 24, limit = 200 } = {},
): Promise<LogLine[]> {
  if (!SEARCH_TERM.test(term)) throw new Error(`not a searchable id: ${JSON.stringify(term)}`);
  const match = `dt > now() - INTERVAL ${Math.floor(hours)} HOUR AND position(raw, '${term}') > 0`;
  const branches = LOG_SOURCES.flatMap((source) => [
    `SELECT dt, '${source}' AS source, raw FROM ${logsTable(source)} WHERE ${match}`,
    `SELECT dt, '${source}' AS source, raw FROM ${archiveTable(source)} WHERE _row_type = 1 AND ${match}`,
  ]);
  return query<LogLine>(
    `SELECT DISTINCT dt, source, JSONExtractString(raw, 'level') AS level, JSONExtractString(raw, 'event') AS event, JSONExtractString(raw, 'message') AS message, ifNull(toString(JSONExtract(raw, 'res', 'statusCode', 'Nullable(UInt16)')), '') AS status, raw FROM (${branches.join('\nUNION ALL\n')}) ORDER BY dt LIMIT ${Math.floor(limit)}`,
  );
}
