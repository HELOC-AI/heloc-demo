/**
 * Idempotently provisions Better Stack for every backend service:
 *   - one Telemetry (logs) source per service
 *   - one Errors application per service (Sentry-SDK compatible), correlated with its logs
 *   - with --monitors: one uptime monitor per service /health (needs <SERVICE>__PUBLIC_URL)
 *   - with --alerts: a saved query of error/fatal logs across services + an email alert on it
 *
 * Reads the admin token BETTER_STACK_API_KEY from the repo-root .env and writes the
 * per-service ingestion credentials back into it. Prints ids and hosts only, never tokens.
 *
 *   node scripts/setup-betterstack.ts [--monitors] [--alerts]
 */
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
  updates[`${prefix}BETTERSTACK_ERRORS_DSN`] =
    `https://${String(app.attributes.token)}@${String(app.attributes.ingesting_host)}/${app.id}`;

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

if (process.argv.includes('--alerts')) {
  console.log('alerts:');
  const sources = await listAll('https://telemetry.betterstack.com/api/v1/sources');
  const sourceIds = SERVICES.map((service) => {
    const source = sources.find((s) => s.attributes.name === `${PROJECT}-${service}`);
    if (!source)
      throw new Error(`log source ${PROJECT}-${service} missing; run without --alerts first`);
    return source.id;
  });

  // One saved query over every service's logs: error/fatal lines, which include
  // lead.failed, email.failed, unhandled exceptions and failed startups.
  const explorationName = `${PROJECT}: error logs (all services)`;
  const exploration = await findOrCreate(
    'exploration',
    'https://telemetry.betterstack.com/api/v2/explorations',
    explorationName,
    async () =>
      (
        (await api('POST', 'https://telemetry.betterstack.com/api/v2/explorations', {
          name: explorationName,
          team_name: 'Your team',
          chart: {
            chart_type: 'line_chart',
            description: 'error/fatal log lines across intake, figure-mock, chase, email',
          },
          queries: [
            {
              name: 'errors',
              query_type: 'sql_expression',
              sql_query:
                "SELECT {{time}} AS time, count(*) AS value FROM {{source}} WHERE time BETWEEN {{start_time}} AND {{end_time}} AND JSONExtractString(raw, 'level') IN ('error', 'fatal') GROUP BY time",
              source_variable: 'source',
            },
          ],
          variables: [{ name: 'source', variable_type: 'source', values: sourceIds }],
        })) as { data: Resource }
      ).data,
  );

  const alertName = `${PROJECT}: errors logged`;
  const alerts = (await listAll('https://telemetry.betterstack.com/api/v2/alerts')).filter(
    (a) => a.attributes.name === alertName,
  );
  if (alerts.length > 0) {
    console.log(`  alert "${alertName}" exists (id ${alerts[0]!.id})`);
  } else {
    const created = (await api(
      'POST',
      `https://telemetry.betterstack.com/api/v2/explorations/${exploration.id}/alerts`,
      {
        name: alertName,
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
    console.log(`  alert "${alertName}" created (id ${created.data.id}); emails the current team`);
  }
}

upsertRootEnv(updates, 'Better Stack ingestion (written by scripts/setup-betterstack.ts)');
console.log(`\nWrote ${Object.keys(updates).length} values to .env (not printed).`);
