import { LOG_SOURCES, type Section, type Stats24h, type TopError } from '@heloc/ops';
import { formatCount, hourlyChart, parseUtc, type HourlyChart } from '@/lib/ops-view';
import { Ago, Panel, SectionBody } from './ui';

/** Categorical slots in fixed order, one per log source; anything unexpected gets the last one. */
const SERIES_COLORS = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#4a3aa7'];
const seriesColor = (series: string) =>
  SERIES_COLORS[LOG_SOURCES.indexOf(series as (typeof LOG_SOURCES)[number])] ?? SERIES_COLORS[5];

/** Log-derived numbers for the last 24 hours (Better Stack metrics, 5-minute resolution). */
export function StatsPanel({ stats, now }: { stats: Section<Stats24h>; now: Date }) {
  return (
    <Panel id="stats" title="Last 24 hours" description="From Better Stack log metrics">
      <SectionBody section={stats}>
        {(data) => (
          <div className="space-y-8">
            <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Tile label="Leads submitted" value={data.leadsSubmitted} />
              <Tile label="Leads failed" value={data.leadsFailed} alarming />
              <Tile label="Errors logged" value={data.errors} alarming />
              <Tile label="HTTP 5xx responses" value={data.http5xx} alarming />
            </dl>
            <ErrorsChart chart={hourlyChart(data.errorsByHour, { now, order: LOG_SOURCES })} />
            <TopErrors errors={data.topErrors} now={now} />
          </div>
        )}
      </SectionBody>
    </Panel>
  );
}

function Tile({ label, value, alarming }: { label: string; value: number; alarming?: boolean }) {
  const flagged = alarming && value > 0;
  return (
    <div
      className={`rounded-xl border px-4 py-3 ${flagged ? 'border-amber-200 bg-amber-50/50' : 'border-slate-200'}`}
    >
      <dt className="text-xs font-medium tracking-wide text-slate-500 uppercase">{label}</dt>
      <dd className="mt-1 text-2xl font-semibold tracking-tight text-slate-900 tabular-nums">
        {formatCount(value)}
      </dd>
    </div>
  );
}

const hourLabel = (iso: string) => `${iso.slice(11, 16)}`;

/** Stacked bars, one per hour; hover a bar for its breakdown. */
function ErrorsChart({ chart }: { chart: HourlyChart }) {
  const total = chart.buckets.reduce((sum, b) => sum + b.total, 0);
  const peak = chart.buckets.find((b) => b.total === chart.max);
  const summary =
    total === 0
      ? 'No errors logged in the last 24 hours.'
      : `${formatCount(total)} errors in the last 24 hours, peaking at ${formatCount(chart.max)} in the hour from ${hourLabel(peak!.time)} UTC.`;
  return (
    <figure>
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
        <figcaption className="text-sm font-medium text-slate-900">
          Errors per hour, by service
        </figcaption>
        {chart.series.length > 0 && (
          <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">
            {chart.series.map((series) => (
              <li key={series} className="flex items-center gap-1.5">
                <span
                  aria-hidden
                  className="size-2.5 rounded-sm"
                  style={{ backgroundColor: seriesColor(series) }}
                />
                {series}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="mt-4 flex gap-2">
        <div
          aria-hidden
          className="flex h-36 w-6 shrink-0 flex-col justify-between text-right text-[11px] text-slate-400 tabular-nums"
        >
          <span>{chart.max > 0 ? formatCount(chart.max) : ''}</span>
          <span>0</span>
        </div>
        <div className="relative min-w-0 flex-1">
          <div role="img" aria-label={summary} className="relative flex h-36 items-end gap-0.5">
            <span
              aria-hidden
              className="absolute inset-x-0 top-0 border-t border-dashed border-slate-200"
            />
            {chart.buckets.map((bucket) => (
              <div
                key={bucket.time}
                title={barTitle(bucket, chart.series)}
                className="flex h-full min-w-0 flex-1 flex-col-reverse gap-0.5 rounded-t hover:bg-slate-100/80"
              >
                {bucket.values.map((value, i) =>
                  value > 0 ? (
                    <span
                      key={chart.series[i]}
                      className="block w-full rounded-[3px]"
                      style={{
                        height: `${(value / chart.max) * 100}%`,
                        minHeight: 2,
                        backgroundColor: seriesColor(chart.series[i]!),
                      }}
                    />
                  ) : null,
                )}
              </div>
            ))}
            {total === 0 && (
              <p className="absolute inset-0 flex items-center justify-center text-sm text-slate-500">
                No errors logged in the last 24 hours
              </p>
            )}
          </div>
          <div className="border-t border-slate-300" />
          <div aria-hidden className="mt-1 flex text-[11px] text-slate-400 tabular-nums">
            {chart.buckets.map((bucket, i) => (
              <span key={bucket.time} className="min-w-0 flex-1 overflow-visible whitespace-nowrap">
                {i % 6 === 0 ? hourLabel(bucket.time) : ''}
              </span>
            ))}
          </div>
        </div>
      </div>
      <p className="mt-1 text-right text-[11px] text-slate-400">Hours in UTC</p>
    </figure>
  );
}

function barTitle(bucket: HourlyChart['buckets'][number], series: string[]): string {
  const parts = bucket.values
    .map((value, i) => (value > 0 ? `${series[i]} ${formatCount(value)}` : undefined))
    .filter(Boolean);
  const head = `${hourLabel(bucket.time)} UTC: ${formatCount(bucket.total)} ${bucket.total === 1 ? 'error' : 'errors'}`;
  return parts.length ? `${head} (${parts.join(', ')})` : head;
}

function TopErrors({ errors, now }: { errors: TopError[]; now: Date }) {
  return (
    <div>
      <h3 className="text-sm font-medium text-slate-900">Top errors</h3>
      {errors.length === 0 ? (
        <p className="mt-2 text-sm text-slate-500">No error messages in the last 24 hours.</p>
      ) : (
        <div className="mt-3 overflow-x-auto rounded-xl border border-slate-200">
          <table className="w-full min-w-[40rem] text-left text-sm">
            <thead className="bg-slate-50 text-xs text-slate-500">
              <tr>
                <th scope="col" className="px-4 py-2 font-medium">
                  Service
                </th>
                <th scope="col" className="px-4 py-2 font-medium">
                  Message
                </th>
                <th scope="col" className="px-4 py-2 text-right font-medium">
                  Count
                </th>
                <th scope="col" className="px-4 py-2 text-right font-medium">
                  Last seen
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {errors.map((error) => {
                const lastSeen = parseUtc(error.last_seen);
                return (
                  <tr
                    key={`${error.service}-${error.event}-${error.message}`}
                    className="align-top"
                  >
                    <td className="px-4 py-2.5 whitespace-nowrap text-slate-700">
                      <span className="flex items-center gap-1.5">
                        <span
                          aria-hidden
                          className="size-2 rounded-sm"
                          style={{ backgroundColor: seriesColor(error.service) }}
                        />
                        {error.service}
                      </span>
                    </td>
                    <td className="px-4 py-2.5">
                      {error.event && (
                        <code className="mr-2 rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs text-slate-700">
                          {error.event}
                        </code>
                      )}
                      {error.message !== error.event && (
                        <span className="break-words text-slate-900">{error.message}</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-right font-medium text-slate-900 tabular-nums">
                      {formatCount(error.occurrences)}
                    </td>
                    <td className="px-4 py-2.5 text-right whitespace-nowrap text-slate-600">
                      {lastSeen ? <Ago date={lastSeen} now={now} /> : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
