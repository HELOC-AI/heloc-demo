/**
 * Idempotently provisions Better Stack for every backend service:
 *   - one Telemetry (logs) source per service
 *   - one Errors application per service (Sentry-SDK compatible), correlated with its logs
 *   - with --monitors: one uptime monitor per service /health (needs <SERVICE>__PUBLIC_URL)
 *   - with --alerts: a saved query of error/fatal logs across services + an email alert on it,
 *     and ALERT_EMAIL made the current on-call (free plan has no escalation policies)
 *
 * Reads the admin token BETTER_STACK_API_KEY from the repo-root .env and writes the
 * per-service ingestion credentials back into it. Prints ids and hosts only, never tokens.
 *
 *   node scripts/setup-betterstack.ts [--monitors] [--alerts]
 */
import { ALERT_RULES } from '@heloc/ops';
import { readRootEnv, requireVar, SERVICES, servicePrefix, upsertRootEnv } from './lib/root-env.ts';

const PROJECT = 'heloc';
const env = readRootEnv();
const token = requireVar(env, 'BETTER_STACK_API_KEY');

interface Resource {
  id: string;
  attributes: Record<string, unknown>;
}

async function api(method: string, url: string, body?: unknown): Promise<unknown> {
  const response = await fetch(url, {
    method,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${method} ${url} → ${response.status}: ${text.slice(0, 500)}`);
  return text ? JSON.parse(text) : undefined;
}

async function listAll(url: string): Promise<Resource[]> {
  const items: Resource[] = [];
  let next: string | null = url;
  while (next) {
    const page = (await api('GET', next)) as {
      data: Resource[];
      pagination?: { next: string | null };
    };
    items.push(...page.data);
    next = page.pagination?.next ?? null;
  }
  return items;
}

async function findOrCreate(
  kind: string,
  listUrl: string,
  name: string,
  create: () => Promise<Resource>,
  nameAttribute = 'name',
): Promise<Resource> {
  const existing = (await listAll(listUrl)).find((r) => r.attributes[nameAttribute] === name);
  if (existing) {
    console.log(`  ${kind} "${name}" exists (id ${existing.id})`);
    return existing;
  }
  const created = await create();
  console.log(`  ${kind} "${name}" created (id ${created.id})`);
  return created;
}

const updates: Record<string, string> = {};

for (const service of SERVICES) {
  console.log(`${service}:`);
  const prefix = servicePrefix(service);
  const name = `${PROJECT}-${service}`;

  const source = await findOrCreate(
    'log source',
    'https://telemetry.betterstack.com/api/v1/sources',
    name,
    async () =>
      (
        (await api('POST', 'https://telemetry.betterstack.com/api/v1/sources', {
          name,
          platform: 'javascript',
        })) as { data: Resource }
      ).data,
  );
  updates[`${prefix}BETTERSTACK_SOURCE_TOKEN`] = String(source.attributes.token);
  updates[`${prefix}BETTERSTACK_INGESTING_HOST`] = String(source.attributes.ingesting_host);

  const app = await findOrCreate(
    'errors app',
    'https://errors.betterstack.com/api/v2/applications',
    name,
    async () =>
      (
        (await api('POST', 'https://errors.betterstack.com/api/v2/applications', {
          name,
          platform: 'fastify_errors',
          correlate_with_source_id: source.id,
        })) as { data: Resource }
      ).data,
  );
  // An Errors app correlated with a log source ingests through that source: the DSN takes
  // the source's host *and token*. The application's own token is rejected (HTTP 401).
  updates[`${prefix}BETTERSTACK_ERRORS_DSN`] =
    `https://${String(source.attributes.token)}@${String(source.attributes.ingesting_host)}/${app.id}`;

  if (process.argv.includes('--monitors')) {
    const publicUrl = env[`${prefix}PUBLIC_URL`];
    if (!publicUrl) {
      console.log(`  monitor skipped: ${prefix}PUBLIC_URL not set`);
      continue;
    }
    const url = `${publicUrl.replace(/\/+$/, '')}/health`;
    await findOrCreate(
      'monitor',
      'https://uptime.betterstack.com/api/v2/monitors',
      name,
      async () =>
        (
          (await api('POST', 'https://uptime.betterstack.com/api/v2/monitors', {
            pronounceable_name: name,
            url,
            monitor_type: 'status',
            check_frequency: 60,
            request_timeout: 15,
            recovery_period: 60,
            confirmation_period: 0,
            email: true,
          })) as { data: Resource }
        ).data,
      'pronounceable_name',
    );
  }
}

const webUrl = env.WEB__PUBLIC_URL;
if (process.argv.includes('--monitors') && webUrl) {
  console.log('web:');
  // Keyword check: the page must actually render, not just answer 200.
  await findOrCreate(
    'monitor',
    'https://uptime.betterstack.com/api/v2/monitors',
    `${PROJECT}-web`,
    async () =>
      (
        (await api('POST', 'https://uptime.betterstack.com/api/v2/monitors', {
          pronounceable_name: `${PROJECT}-web`,
          url: webUrl,
          monitor_type: 'keyword',
          required_keyword: 'HELOC',
          check_frequency: 60,
          request_timeout: 15,
          recovery_period: 60,
          confirmation_period: 0,
          email: true,
        })) as { data: Resource }
      ).data,
    'pronounceable_name',
  );
}

if (process.argv.includes('--alerts')) {
  console.log('alerts:');
  const sources = await listAll('https://telemetry.betterstack.com/api/v1/sources');
  const sourceIds = [...SERVICES, 'email-inbound'].map((service) => {
    const source = sources.find((s) => s.attributes.name === `${PROJECT}-${service}`);
    if (!source)
      throw new Error(`log source ${PROJECT}-${service} missing; run without --alerts first`);
    return source.id;
  });

  // Everything HELOC alerts on goes to ALERT_EMAIL. Escalation policies need a paid
  // Better Stack plan, so on the free plan that person is made the current on-call
  // (monitors and alerts notify on-call / team by email).
  const alertEmail = requireVar(env, 'ALERT_EMAIL');
  const calendar = (await listAll('https://uptime.betterstack.com/api/v2/on-calls')).find(
    (c) => c.attributes.default_calendar,
  );
  if (!calendar) throw new Error('no default on-call calendar');
  const onCall = (await api(
    'GET',
    `https://uptime.betterstack.com/api/v2/on-calls/${calendar.id}`,
  )) as {
    data: { relationships: { on_call_users: { data: { id: string }[] } } };
    included?: Resource[];
  };
  const onCallEmails = (onCall.included ?? []).map((u) => u.attributes.email);
  if (onCallEmails.includes(alertEmail)) {
    console.log(`  on-call: ${alertEmail} (already)`);
  } else {
    const now = new Date();
    await api('POST', `https://uptime.betterstack.com/api/v2/on-calls/${calendar.id}/events`, {
      starts_at: now.toISOString(),
      ends_at: new Date(now.getTime() + 365 * 24 * 3600 * 1000).toISOString(),
      users: [alertEmail],
    });
    console.log(`  on-call: ${alertEmail} (for the next 365 days)`);
  }
  const monitors = (await listAll('https://uptime.betterstack.com/api/v2/monitors')).filter((m) =>
    String(m.attributes.pronounceable_name).startsWith(`${PROJECT}-`),
  );
  for (const monitor of monitors) {
    if (!monitor.attributes.email) {
      await api('PATCH', `https://uptime.betterstack.com/api/v2/monitors/${monitor.id}`, {
        email: true,
      });
    }
    console.log(`  monitor "${String(monitor.attributes.pronounceable_name)}" emails on-call`);
  }

  // Log alerts: each is a saved query (exploration) over the *logs* of every service plus
  // a threshold alert on it. Dashboards only see metrics; explorations see raw logs.
  const existingAlerts = await listAll('https://telemetry.betterstack.com/api/v2/alerts');
  // The rules are shared with the /ops page and scripts/ops.ts (@heloc/ops).
  for (const spec of ALERT_RULES) {
    const exploration = await findOrCreate(
      'exploration',
      'https://telemetry.betterstack.com/api/v2/explorations',
      spec.exploration,
      async () =>
        (
          (await api('POST', 'https://telemetry.betterstack.com/api/v2/explorations', {
            name: spec.exploration,
            team_name: 'Your team',
            chart: { chart_type: 'line_chart', description: spec.description },
            queries: [
              {
                name: 'matches',
                query_type: 'sql_expression',
                sql_query: `SELECT {{time}} AS time, count(*) AS value FROM {{source}} WHERE time BETWEEN {{start_time}} AND {{end_time}} AND ${spec.rawWhere} GROUP BY time`,
                source_variable: 'source',
              },
            ],
            variables: [{ name: 'source', variable_type: 'source', values: sourceIds }],
          })) as { data: Resource }
        ).data,
    );
    // Keep the source list current (e.g. when a service is added).
    await api('PATCH', `https://telemetry.betterstack.com/api/v2/explorations/${exploration.id}`, {
      variables: [{ name: 'source', variable_type: 'source', values: sourceIds }],
    });
    const alert = existingAlerts.find((a) => a.attributes.name === spec.alert);
    if (alert) {
      console.log(`  alert "${spec.alert}" exists (id ${alert.id}); emails the team`);
      continue;
    }
    const created = (await api(
      'POST',
      `https://telemetry.betterstack.com/api/v2/explorations/${exploration.id}/alerts`,
      {
        name: spec.alert,
        alert_type: 'threshold',
        operator: 'higher_than',
        value: 0,
        check_period: 60,
        query_period: 300,
        confirmation_period: 0,
        recovery_period: 300,
        on_missing_data: 'treat_as_zero',
        email: true,
      },
    )) as { data: Resource };
    console.log(`  alert "${spec.alert}" created (id ${created.data.id}); emails the team`);
  }
}

upsertRootEnv(updates, 'Better Stack ingestion (written by scripts/setup-betterstack.ts)');
console.log(`\nWrote ${Object.keys(updates).length} values to .env (not printed).`);
