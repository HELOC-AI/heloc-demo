import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import type { Database } from './drizzle-lead-repository.ts';
import * as schema from './schema.ts';

export interface DatabaseClient {
  db: Database;
  ping(): Promise<void>;
  close(): Promise<void>;
}

/** Supabase session pooler (IPv4). A small pool is plenty for one intake instance. */
export function connectDatabase(url: string): DatabaseClient {
  const client = postgres(url, { max: 5, idle_timeout: 20, connect_timeout: 10 });
  const db = drizzle(client, { schema });
  return {
    db,
    ping: async () => {
      await db.execute(sql`select 1`);
    },
    close: () => client.end({ timeout: 5 }),
  };
}
