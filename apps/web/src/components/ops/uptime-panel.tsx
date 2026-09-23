import type { Section, StatusPage, StatusPageResource } from '@heloc/ops';
import { formatAvailability, formatDuration, humanize } from '@/lib/ops-view';
import { Badge, ExternalLink, Panel, SectionBody, type Tone } from './ui';

const DAY_COLORS: Record<string, string> = {
  operational: 'bg-emerald-500',
  degraded: 'bg-amber-400',
  downtime: 'bg-red-500',
  maintenance: 'bg-sky-400',
  not_monitored: 'bg-slate-200',
};

const STATE_TONES: Record<string, Tone> = {
  operational: 'ok',
  degraded: 'warn',
  downtime: 'bad',
  maintenance: 'info',
};

/** Better Stack status page: current state and a 30-day history strip per resource. */
export function UptimePanel({ statusPage }: { statusPage: Section<StatusPage> }) {
  return (
    <Panel
      id="uptime"
      title="Uptime, last 30 days"
      description="From the public status page's uptime monitors"
      aside={
        statusPage.ok && (
          <Badge tone={STATE_TONES[statusPage.data.state] ?? 'neutral'}>
            Status page: {humanize(statusPage.data.state).toLowerCase()}
          </Badge>
        )
      }
    >
      <SectionBody section={statusPage}>
        {(page) => (
          <>
            {page.resources.length === 0 ? (
              <p className="text-sm text-slate-500">The status page lists no monitors.</p>
            ) : (
              <ul className="space-y-6">
                {page.resources.map((resource) => (
                  <li key={resource.name}>
                    <ResourceHistory resource={resource} />
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-6 flex flex-col gap-3 border-t border-slate-200 pt-4 text-xs text-slate-500 sm:flex-row sm:items-center sm:justify-between">
              <Legend />
              <ExternalLink href={page.url}>Open status page</ExternalLink>
            </div>
          </>
        )}
      </SectionBody>
    </Panel>
  );
}

function ResourceHistory({ resource }: { resource: StatusPageResource }) {
  const bad = resource.history.filter((d) => d.status === 'downtime' || d.status === 'degraded');
  const label =
    bad.length === 0
      ? `${resource.name}: no incidents in the last ${resource.history.length} days`
      : `${resource.name}: ${bad.length} of ${resource.history.length} days with downtime or degraded service`;
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="flex min-w-0 items-center gap-2 text-sm font-medium text-slate-900">
          <span className="truncate">{resource.name}</span>
          {resource.status !== 'operational' && (
            <Badge tone={STATE_TONES[resource.status] ?? 'neutral'}>
              {humanize(resource.status)}
            </Badge>
          )}
        </h3>
        <p className="shrink-0 text-sm text-slate-600 tabular-nums">
          {formatAvailability(resource.availability)} <span className="text-slate-400">uptime</span>
        </p>
      </div>
      <div role="img" aria-label={label} className="mt-2 flex h-8 gap-[2px]">
        {resource.history.map((day) => (
          <span
            key={day.day}
            title={dayTitle(day)}
            className={`block min-w-0 flex-1 rounded-[2px] transition-opacity hover:opacity-70 ${
              DAY_COLORS[day.status] ?? 'bg-slate-200'
            }`}
          />
        ))}
      </div>
      <div aria-hidden className="mt-1 flex justify-between text-[11px] text-slate-400">
        <span>{resource.history.length} days ago</span>
        <span>Today</span>
      </div>
    </div>
  );
}

function dayTitle(day: StatusPageResource['history'][number]): string {
  const date = new Date(`${day.day}T00:00:00Z`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
  const downtime = day.downtimeSeconds > 0 ? `, ${formatDuration(day.downtimeSeconds)} down` : '';
  return `${date}: ${humanize(day.status)}${downtime}`;
}

function Legend() {
  const items: [string, string][] = [
    ['operational', 'Operational'],
    ['degraded', 'Degraded'],
    ['downtime', 'Downtime'],
    ['maintenance', 'Maintenance'],
    ['not_monitored', 'No data'],
  ];
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1">
      {items.map(([status, label]) => (
        <li key={status} className="flex items-center gap-1.5">
          <span aria-hidden className={`size-2.5 rounded-sm ${DAY_COLORS[status]}`} />
          {label}
        </li>
      ))}
    </ul>
  );
}
