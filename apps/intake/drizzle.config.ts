import { defineConfig } from 'drizzle-kit';

// `pnpm db:generate` only diffs the schema file; it needs no database connection.
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/infrastructure/db/schema.ts',
  out: './drizzle',
});
