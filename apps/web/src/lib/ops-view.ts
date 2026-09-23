import type { Overview } from '@heloc/ops';

/** Display helpers for the /ops page: pure, so the server render and tests agree. */

/**
 * Better Stack (ClickHouse) timestamps are UTC without a zone: "2026-09-23 10:15:00.123456".
 * ISO strings pass through. Returns undefined for anything unparseable.
 */
export function parseUtc(value: string | null | undefined): Date | undefined {
  if (!value) return undefined;
  const clickhouse = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(\.\d{1,3})?\d*$/.exec(value);
  const date = new Date(
    clickhouse ? `${clickhouse[1]}T${clickhouse[2]}${clickhouse[3] ?? ''}Z` : value,
  );
  return Number.isNaN(date.getTime()) ? undefined : date;
}

/** "just now", "45s ago", "12 min ago", "3 h ago", "2 d ago" (future times read as "just now"). */
export function formatAgo(then: Date, now: Date): string {
  const seconds = Math.floor((now.getTime() - then.getTime()) / 1000);
  if (seconds < 5) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.floor(hours / 24)} d ago`;
}

/** 0.99987 → "99.98%" (truncated, so anything short of perfect never reads as 100%). */
export function formatAvailability(ratio: number): string {
  if (ratio >= 1) return '100%';
  const percent = Math.floor(Math.max(0, ratio) * 10_000) / 100;
  return `${percent.toFixed(2)}%`;
}

/** 84 → "84 ms", 1234 → "1.2 s". */
export function formatLatency(ms: number): string {
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`;
}

/** Downtime: 42 → "42s", 252 → "4m 12s", 3900 → "1h 5m". */
export function formatDuration(totalSeconds: number): string {
  const seconds = Math.max(0, Math.round(totalSeconds));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return seconds % 60 ? `${minutes}m ${seconds % 60}s` : `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return minutes % 60 ? `${hours}h ${minutes % 60}m` : `${hours}h`;
}

/** "14:05 UTC" on `now`'s day, "Sep 22, 14:05 UTC" before it. */
export function formatUtcShort(date: Date, now: Date): string {
  const time = `${date.toISOString().slice(11, 16)} UTC`;
  if (date.toISOString().slice(0, 10) === now.toISOString().slice(0, 10)) return time;
  const day = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  return `${day}, ${time}`;
}

const count = new Intl.NumberFormat('en-US');

/** 12345 → "12,345". */
export function formatCount(value: number): string {
  return count.format(value);
}

/** The first block of a Lead id, enough to tell Leads apart in a table. */
export function shortLeadId(leadId: string): string {
  return leadId.split('-')[0] ?? leadId;
}

/** Status and step codes as words: "need_more_documents" → "Need more documents". */
export function humanize(code: string): string {
  const words = code.replaceAll('_', ' ').replaceAll('-', ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export interface OverviewSummary {
  /** Unhealthy services + firing alerts + Leads needing attention. */
  issues: number;
  headline: string;
  /** What the issues are: "1 service down", "2 alerts firing", … */
  details: string[];
  /** Sections that could not be loaded, so "no issues" is only as good as what we saw. */
  unavailable: string[];
}

const SECTION_NAMES = {
  health: 'service health',
  statusPage: 'uptime history',
  alerts: 'alerts',
  stats: '24h stats',
  attention: 'Leads needing attention',
} as const;

export function summarize(overview: Overview): OverviewSummary {
  const { health, alerts, attention } = overview;
  const down = health.ok ? health.data.filter((h) => !h.ok).length : 0;
  const firing = alerts.ok ? alerts.data.filter((a) => a.firing).length : 0;
  const leads = attention.ok ? attention.data.length : 0;
  const issues = down + firing + leads;
  const details = [
    down && `${plural(down, 'service')} down`,
    firing && `${plural(firing, 'alert')} firing`,
    leads && `${plural(leads, 'Lead')} ${leads === 1 ? 'needs' : 'need'} attention`,
  ].filter((detail): detail is string => !!detail);
  const unavailable = (Object.keys(SECTION_NAMES) as (keyof typeof SECTION_NAMES)[])
    .filter((key) => !overview[key].ok)
    .map((key) => SECTION_NAMES[key]);
  return {
    issues,
    // Only claim all is well when every section could be checked.
    headline:
      issues > 0
        ? plural(issues, 'issue')
        : unavailable.length > 0
          ? 'No issues found'
          : 'All systems operational',
    details,
    unavailable,
  };
}

function plural(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? '' : 's'}`;
}

export interface HourBucket {
  /** Start of the hour (UTC, ISO). */
  time: string;
  total: number;
  /** Value per series, in `series` order (0 when the series logged nothing). */
  values: number[];
}

export interface HourlyChart {
  series: string[];
  buckets: HourBucket[];
  max: number;
}

const HOUR = 3_600_000;

/**
 * Hourly points → one bucket per hour for the `hours` ending with `now`'s hour, gaps filled
 * with zeros. Series follow `order` first (stable colors), then any others by name.
 */
export function hourlyChart(
  points: readonly { time: string; series: string; value: number }[],
  { now, hours = 24, order = [] }: { now: Date; hours?: number; order?: readonly string[] },
): HourlyChart {
  const seen = new Set(points.map((p) => p.series));
  const series = [
    ...order.filter((s) => seen.has(s)),
    ...[...seen].filter((s) => !order.includes(s)).sort(),
  ];
  const lastHour = Math.floor(now.getTime() / HOUR) * HOUR;
  const first = lastHour - (hours - 1) * HOUR;
  const buckets: HourBucket[] = Array.from({ length: hours }, (_, i) => ({
    time: new Date(first + i * HOUR).toISOString(),
    total: 0,
    values: series.map(() => 0),
  }));
  for (const point of points) {
    const at = parseUtc(point.time)?.getTime();
    if (at === undefined) continue;
    const bucket = buckets[Math.floor((at - first) / HOUR)];
    if (!bucket) continue;
    bucket.values[series.indexOf(point.series)]! += point.value;
    bucket.total += point.value;
  }
  return { series, buckets, max: Math.max(0, ...buckets.map((b) => b.total)) };
}
