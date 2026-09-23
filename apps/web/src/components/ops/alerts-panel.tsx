import { ALERT_WINDOW_MINUTES, type AlertState, type Section } from '@heloc/ops';
import type { ReactNode } from 'react';
import { formatCount, parseUtc } from '@/lib/ops-view';
import { Ago, Badge, ExternalLink, Panel, RUNBOOK_URL, SectionBody } from './ui';

/** The Better Stack log alerts, and whether each would fire right now. */
export function AlertsPanel({ alerts, now }: { alerts: Section<AlertState[]>; now: Date }) {
  const firing = alerts.ok ? alerts.data.filter((a) => a.firing).length : 0;
  return (
    <Panel
      id="alerts"
      title="Alerts"
      description={`Log alerts fire on any match within ${ALERT_WINDOW_MINUTES} minutes`}
      aside={
        alerts.ok && (
          <Badge tone={firing ? 'bad' : 'ok'}>{firing ? `${firing} firing` : 'None firing'}</Badge>
        )
      }
      flush
    >
      <SectionBody section={alerts} flush>
        {(states) => (
          <ul className="divide-y divide-slate-200">
            {states.map((alert) => (
              <AlertRow key={alert.id} alert={alert} now={now} />
            ))}
          </ul>
        )}
      </SectionBody>
    </Panel>
  );
}

function AlertRow({ alert, now }: { alert: AlertState; now: Date }) {
  const lastSeen = parseUtc(alert.lastSeen);
  // "docs/RUNBOOK.md §4" → "Runbook §4"
  const section = /§\s*\S+/.exec(alert.runbook)?.[0];
  return (
    <li className={`px-5 py-4 sm:px-6 ${alert.firing ? 'bg-red-50/50' : ''}`}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={alert.firing ? 'bad' : 'ok'}>{alert.firing ? 'Firing' : 'Quiet'}</Badge>
            <h3 className="font-medium text-slate-900">{alert.alert}</h3>
          </div>
          <p className="mt-1 text-sm text-pretty text-slate-600">{alert.description}</p>
        </div>
        <dl className="grid shrink-0 grid-cols-3 gap-x-5 gap-y-0.5 text-sm sm:text-right">
          <Stat label={`Last ${ALERT_WINDOW_MINUTES} min`} value={formatCount(alert.lastWindow)} />
          <Stat label="Last 24h" value={formatCount(alert.last24h)} />
          <Stat
            label="Last seen"
            value={lastSeen ? <Ago date={lastSeen} now={now} /> : 'Not in 24h'}
          />
        </dl>
      </div>
      <p className="mt-2 text-xs">
        <ExternalLink href={RUNBOOK_URL}>Runbook{section ? ` ${section}` : ''}</ExternalLink>
      </p>
    </li>
  );
}

function Stat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex flex-col-reverse">
      <dt className="text-xs whitespace-nowrap text-slate-500">{label}</dt>
      <dd className="font-medium whitespace-nowrap text-slate-900 tabular-nums">{value}</dd>
    </div>
  );
}
