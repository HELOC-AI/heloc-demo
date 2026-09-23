import { LOG_SOURCES, type LogSource } from './catalog.ts';
import { IS_5XX, IS_ERROR, REPLY_FAILURE_EVENTS } from './metrics.ts';

/**
 * The log alerts (Better Stack explorations + threshold alerts, see setup-betterstack.ts):
 * each fires when any matching log line arrives within a 5-minute window.
 */
export interface AlertRule {
  id: 'errors' | 'http5xx' | 'replyFailures';
  /** Better Stack alert name. */
  alert: string;
  /** Better Stack exploration the alert watches. */
  exploration: string;
  description: string;
  /** Match on raw log lines (explorations, hot-tier logs). */
  rawWhere: string;
  /** The same match on the metrics tables (history). */
  metricsWhere: string;
  sources: readonly LogSource[];
  runbook: string;
}

export const ALERT_WINDOW_MINUTES = 5;

export const ALERT_RULES: readonly AlertRule[] = [
  {
    id: 'errors',
    alert: 'heloc: errors logged',
    exploration: 'heloc: error logs (all services)',
    description: 'error/fatal log lines: lead.failed, email.failed, exceptions, failed startups',
    rawWhere: "JSONExtractString(raw, 'level') IN ('error', 'fatal')",
    metricsWhere: IS_ERROR,
    sources: LOG_SOURCES,
    runbook: 'docs/RUNBOOK.md §4',
  },
  {
    id: 'http5xx',
    alert: 'heloc: HTTP 5xx responses',
    exploration: 'heloc: HTTP 5xx (all services)',
    description: 'responses with status >= 500',
    rawWhere: "JSONExtractInt(raw, 'res', 'statusCode') >= 500",
    metricsWhere: IS_5XX,
    sources: LOG_SOURCES,
    runbook: 'docs/RUNBOOK.md §4',
  },
  {
    id: 'replyFailures',
    alert: 'heloc: borrower reply pipeline failing',
    exploration: 'heloc: reply pipeline failures',
    description: 'the email Worker could not hand a borrower reply to intake',
    rawWhere: `JSONExtractString(raw, 'event') IN (${REPLY_FAILURE_EVENTS.map((e) => `'${e}'`).join(', ')})`,
    metricsWhere: `label('event') IN (${REPLY_FAILURE_EVENTS.map((e) => `'${e}'`).join(', ')})`,
    sources: LOG_SOURCES,
    runbook: 'docs/RUNBOOK.md §6',
  },
];
