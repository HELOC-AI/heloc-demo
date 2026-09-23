/**
 * Fails when an app's .env.example drifts from its env schema in @heloc/config,
 * so the documented variables are always exactly the ones the service reads.
 */
import { readFileSync } from 'node:fs';
import { serviceEnvSchemas } from '@heloc/config';
import { z } from 'zod';

// Injected by the platform, not set by humans.
const PLATFORM_PROVIDED = /^RAILWAY_/;

let failed = false;
for (const [service, schema] of Object.entries(serviceEnvSchemas)) {
  const jsonSchema = z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' }) as {
    properties?: Record<string, unknown>;
  };
  const expected = new Set(
    Object.keys(jsonSchema.properties ?? {}).filter((key) => !PLATFORM_PROVIDED.test(key)),
  );
  const documented = new Set(
    readFileSync(new URL(`../apps/${service}/.env.example`, import.meta.url), 'utf8')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'))
      .map((line) => line.split('=')[0]!.trim()),
  );

  const missing = [...expected].filter((key) => !documented.has(key));
  const unknown = [...documented].filter((key) => !expected.has(key));
  if (missing.length || unknown.length) {
    failed = true;
    console.error(`apps/${service}/.env.example is out of sync with its schema:`);
    if (missing.length) console.error(`  missing: ${missing.join(', ')}`);
    if (unknown.length) console.error(`  not in schema: ${unknown.join(', ')}`);
  } else {
    console.log(`apps/${service}/.env.example ✓ (${expected.size} vars)`);
  }
}
process.exit(failed ? 1 : 0);
