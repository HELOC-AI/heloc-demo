/**
 * Applies drizzle/ migrations to DATABASE_URL. Runs as Railway's pre-deploy command,
 * so a deploy never starts against an out-of-date schema.
 */
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}

const client = postgres(url, { max: 1, onnotice: () => {} });
try {
  await migrate(drizzle(client), {
    migrationsFolder: new URL('../drizzle', import.meta.url).pathname,
  });
  console.log(JSON.stringify({ level: 'info', service: 'intake', event: 'db.migrated' }));
} finally {
  await client.end();
}
