/**
 * Idempotently provisions Better Stack for every backend service:
 *   - one Telemetry (logs) source per service
 *   - one Errors application per service (Sentry-SDK compatible), correlated with its logs
 *   - with --monitors: one uptime monitor per service /health (needs <SERVICE>__PUBLIC_URL)
 *
 * Reads the admin token BETTER_STACK_API_KEY from the repo-root .env and writes the
 * per-service ingestion credentials back into it. Prints ids and hosts only, never tokens.
 *
 *   node scripts/setup-betterstack.ts [--monitors]
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

upsertRootEnv(updates, 'Better Stack ingestion (written by scripts/setup-betterstack.ts)');
console.log(`\nWrote ${Object.keys(updates).length} values to .env (not printed).`);
