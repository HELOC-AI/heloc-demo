import { loadOverview, STATUS_PAGE_URL } from '@heloc/ops';
import type { Metadata } from 'next';
import { AlertsPanel } from '@/components/ops/alerts-panel';
import { AttentionTable } from '@/components/ops/attention-table';
import { AutoRefresh } from '@/components/ops/auto-refresh';
import { ServiceHealth } from '@/components/ops/service-health';
import { StatsPanel } from '@/components/ops/stats-panel';
import { Summary } from '@/components/ops/summary';
import {
  Badge,
  DASHBOARDS_URL,
  ExternalLink,
  Panel,
  RUNBOOK_URL,
  SectionBody,
} from '@/components/ops/ui';
import { UptimePanel } from '@/components/ops/uptime-panel';
import { opsConfig } from '@/lib/ops-config';
import { summarize } from '@/lib/ops-view';

export const metadata: Metadata = {
  title: 'Operations',
  robots: { index: false },
};

// Live data on every request (and on every router.refresh()).
export const dynamic = 'force-dynamic';

/** Read-only operations overview for the demo; the only action is Replay of a failed Lead. */
export default async function OpsPage() {
  const overview = await loadOverview(opsConfig());
  const now = new Date(overview.generatedAt);
  const { attention } = overview;
  const links = [
    { href: STATUS_PAGE_URL, label: 'Status page' },
    { href: DASHBOARDS_URL, label: 'Better Stack dashboards' },
    { href: RUNBOOK_URL, label: 'Runbook' },
  ];

  return (
    <main className="mx-auto max-w-6xl space-y-6 px-5 py-8 sm:px-8 sm:py-10">
      <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-sm font-semibold text-emerald-700">HELOC demo</p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight text-slate-900">Operations</h1>
          <nav aria-label="Operations tools" className="mt-2">
            <ul className="flex flex-wrap gap-x-5 gap-y-1 text-sm">
              {links.map((link) => (
                <li key={link.href}>
                  <ExternalLink href={link.href}>{link.label}</ExternalLink>
                </li>
              ))}
            </ul>
          </nav>
        </div>
        <AutoRefresh generatedAt={overview.generatedAt} />
      </header>

      <Summary summary={summarize(overview)} />

      <ServiceHealth health={overview.health} />

      <Panel
        id="attention"
        title="Leads needing attention"
        description="Failed, or stuck mid-pipeline. Replay resumes a Lead from the step it still needs."
        aside={
          attention.ok &&
          attention.data.length > 0 && (
            <Badge tone="bad">
              {attention.data.length} {attention.data.length === 1 ? 'Lead' : 'Leads'}
            </Badge>
          )
        }
        flush
      >
        <SectionBody section={attention} flush>
          {(leads) => <AttentionTable leads={leads} now={overview.generatedAt} />}
        </SectionBody>
      </Panel>

      <AlertsPanel alerts={overview.alerts} now={now} />
      <StatsPanel stats={overview.stats} now={now} />
      <UptimePanel statusPage={overview.statusPage} />
    </main>
  );
}
