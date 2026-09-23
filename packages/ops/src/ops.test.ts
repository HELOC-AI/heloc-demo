import { describe, expect, it } from 'vitest';
import { ALERT_RULES } from './alert-rules.ts';
import { PRODUCTION_URLS, metricsTable, serviceUrlsFrom } from './catalog.ts';
import { checkHealth } from './health.ts';
import { QUERIES, toDirectSql } from './metrics.ts';
import { loadOverview } from './overview.ts';
import { createQueryClient } from './query-client.ts';
import { readStatusPage } from './status-page.ts';

type Handler = (url: string, init?: RequestInit) => Response | Promise<Response>;
const fakeFetch = (handler: Handler) =>
  (async (input: string | URL | Request, init?: RequestInit) =>
    handler(String(input), init)) as typeof fetch;
const json = (body: unknown, status = 200) => Response.json(body, { status });

const health = (service: string, extra = {}, status = 200) =>
  json(
    { status: 'ok', service, version: 'abc1234', timestamp: new Date().toISOString(), ...extra },
    status,
  );

const statusPage = {
  data: { attributes: { aggregate_state: 'operational' } },
  included: [
    { type: 'status_page_section', attributes: { name: 'Current status by service' } },
    {
      type: 'status_page_resource',
      attributes: {
        public_name: 'Email Delivery',
        position: 1,
        status: 'operational',
        availability: 0.9991,
        status_history: [{ day: '2026-09-22', status: 'downtime', downtime_duration: 120 }],
      },
    },
    {
      type: 'status_page_resource',
      attributes: { public_name: 'Lead Intake API', position: 0, status: 'operational' },
    },
  ],
};

describe('QUERIES', () => {
  it('become plain ClickHouse over the metrics tables', () => {
    for (const query of Object.values(QUERIES)) {
      const sql = toDirectSql(query.sql(metricsTable), { hours: 24 });
      expect(sql).not.toContain('{{');
      expect(sql).toContain('_metrics_5m)');
      expect(sql).toContain('now() - INTERVAL 24 HOUR');
    }
  });

  it('read each source through the given reference (dashboard: {{source:<id>}})', () => {
    const sql = QUERIES.errors.sql((source) => `{{source:${source}}}`);
    expect(sql).toContain('{{source:intake}}');
    expect(sql).toContain('{{source:email-inbound}}');
  });
});

describe('serviceUrlsFrom', () => {
  it('defaults to production and trims trailing slashes', () => {
    expect(serviceUrlsFrom({ INTAKE_URL: 'http://localhost:4000/' })).toEqual({
      ...PRODUCTION_URLS,
      intake: 'http://localhost:4000',
    });
  });
});

describe('checkHealth', () => {
  it('is ok for a healthy service and reports its version and checks', async () => {
    const result = await checkHealth('intake', 'https://intake.test', {
      fetch: fakeFetch(() => health('intake', { checks: { db: 'ok' } })),
    });
    expect(result).toMatchObject({
      ok: true,
      httpStatus: 200,
      version: 'abc1234',
      checks: { db: 'ok' },
    });
  });

  it('is not ok when the service reports degraded', async () => {
    const result = await checkHealth('intake', 'https://intake.test', {
      fetch: fakeFetch(() => health('intake', { status: 'degraded', checks: { db: 'fail' } }, 503)),
    });
    expect(result).toMatchObject({ ok: false, error: 'status degraded' });
  });

  it('is not ok when the service cannot be reached', async () => {
    const result = await checkHealth('chase', 'https://chase.test', {
      fetch: fakeFetch(() => Promise.reject(new TypeError('fetch failed'))),
    });
    expect(result).toMatchObject({ ok: false, error: 'fetch failed' });
  });

  it('only needs a 2xx for a page without a health body', async () => {
    const result = await checkHealth('web', 'https://web.test', {
      path: '/',
      fetch: fakeFetch((url) => (expect(url).toBe('https://web.test/'), new Response('<html>'))),
    });
    expect(result).toMatchObject({ ok: true, url: 'https://web.test/' });
  });
});

describe('readStatusPage', () => {
  it('lists the resources in page order with their history', async () => {
    const page = await readStatusPage({ fetch: fakeFetch(() => json(statusPage)) });
    expect(page.state).toBe('operational');
    expect(page.resources.map((r) => r.name)).toEqual(['Lead Intake API', 'Email Delivery']);
    expect(page.resources[1]).toMatchObject({
      availability: 0.9991,
      history: [{ day: '2026-09-22', status: 'downtime', downtimeSeconds: 120 }],
    });
  });
});

describe('createQueryClient', () => {
  const connection = { host: 'eu.query.test', username: 'u', password: 'p' };

  it('returns JSONEachRow rows', async () => {
    const query = createQueryClient(connection, {
      fetch: fakeFetch((_url, init) => {
        expect(String(init?.body)).toMatch(/FORMAT JSONEachRow$/);
        expect(new Headers(init?.headers).get('authorization')).toBe(`Basic ${btoa('u:p')}`);
        return new Response('{"value":1}\n{"value":2}\n');
      }),
    });
    expect(await query('SELECT 1')).toEqual([{ value: 1 }, { value: 2 }]);
  });

  it('keeps only the reason of a ClickHouse error (not the echoed query)', async () => {
    const query = createQueryClient(connection, {
      fetch: fakeFetch(
        () =>
          new Response(
            '{"exception":"Code: 47. DB::Exception: Unknown identifier `x` (UNKNOWN_IDENTIFIER). SELECT x"}',
            { status: 404 },
          ),
      ),
    });
    await expect(query('SELECT x')).rejects.toThrow('query failed (404): Unknown identifier `x`');
  });
});

describe('loadOverview', () => {
  const urls = { ...PRODUCTION_URLS, intake: 'https://intake.test' };

  it('keeps every section it could load when another one fails', async () => {
    const overview = await loadOverview(
      { urls, opsApiKey: 'k'.repeat(64) },
      {
        fetch: fakeFetch((url) => {
          if (url.endsWith('index.json')) return json(statusPage);
          if (url.includes('/v1/ops/leads')) return json({ error: 'internal' }, 500);
          if (url.endsWith('/health')) return health('x');
          return new Response('<html>');
        }),
      },
    );
    expect(overview.health).toMatchObject({ ok: true });
    expect(overview.health.ok && overview.health.data.every((h) => h.ok)).toBe(true);
    expect(overview.statusPage).toMatchObject({ ok: true });
    expect(overview.attention).toEqual({
      ok: false,
      error: 'intake GET /v1/ops/leads → HTTP 500',
    });
    expect(overview.alerts).toEqual({
      ok: false,
      error: 'Better Stack query connection not configured',
    });
  });

  it('evaluates every alert rule from recent logs and 24h metrics', async () => {
    const overview = await loadOverview(
      { urls, query: { host: 'q.test', username: 'u', password: 'p' } },
      {
        fetch: fakeFetch((url, init) => {
          if (!url.startsWith('https://q.test')) return health('x');
          const sql = String(init?.body);
          if (sql.includes('_logs)')) {
            return new Response(sql.includes("'level'") ? '{"n":2}\n' : '{"n":0}\n');
          }
          if (sql.includes('last_seen')) {
            return new Response('{"total":3,"last_seen":"2026-09-23 06:55:00.000000"}\n');
          }
          return new Response('{"value":0}\n');
        }),
      },
    );
    expect(overview.alerts.ok && overview.alerts.data).toEqual(
      ALERT_RULES.map((rule) =>
        expect.objectContaining({
          id: rule.id,
          firing: rule.id === 'errors',
          last24h: 3,
          lastSeen: '2026-09-23 06:55:00.000000',
        }),
      ),
    );
  });
});
