import type { HealthCheck, Section } from '@heloc/ops';
import { formatLatency } from '@/lib/ops-view';
import { Badge, Panel, SectionBody } from './ui';

/** Each service's /health (web: its home page), checked live on every render. */
export function ServiceHealth({ health }: { health: Section<HealthCheck[]> }) {
  const down = health.ok ? health.data.filter((h) => !h.ok).length : 0;
  return (
    <Panel
      id="health"
      title="Service health"
      description="Live /health checks, run each time this page loads"
      aside={
        health.ok && (
          <Badge tone={down ? 'bad' : 'ok'}>
            {down
              ? `${down} of ${health.data.length} down`
              : `${health.data.length} of ${health.data.length} up`}
          </Badge>
        )
      }
    >
      <SectionBody section={health}>
        {(checks) => (
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {checks.map((check) => (
              <li key={check.service}>
                <ServiceCard check={check} />
              </li>
            ))}
          </ul>
        )}
      </SectionBody>
    </Panel>
  );
}

function ServiceCard({ check }: { check: HealthCheck }) {
  const facts = [
    check.httpStatus !== undefined && `HTTP ${check.httpStatus}`,
    formatLatency(check.latencyMs),
    check.version && `build ${check.version}`,
  ].filter(Boolean);
  const dependencies = Object.entries(check.checks ?? {});
  return (
    <div
      className={`flex h-full flex-col rounded-xl border px-4 py-3.5 ${
        check.ok ? 'border-slate-200' : 'border-red-200 bg-red-50/50'
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <h3 className="font-medium text-slate-900">{check.service}</h3>
        <Badge tone={check.ok ? 'ok' : 'bad'}>{check.ok ? 'Up' : 'Down'}</Badge>
      </div>
      <p className="mt-0.5 truncate text-xs text-slate-500" title={check.url}>
        {check.url.replace(/^https?:\/\//, '')}
      </p>
      <p className="mt-3 text-sm text-slate-700 tabular-nums">{facts.join(' · ')}</p>
      {dependencies.length > 0 && (
        <p className="mt-1 text-xs text-slate-500">
          {dependencies.map(([name, state]) => `${name}: ${state}`).join(' · ')}
        </p>
      )}
      {check.error && (
        <p className="mt-2 font-mono text-xs break-words text-red-700">{check.error}</p>
      )}
    </div>
  );
}
