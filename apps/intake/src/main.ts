import { intakeEnv, loadConfigOrExit, serviceVersion } from '@heloc/config';
import { createLogger } from '@heloc/logger';
import { startServer } from '@heloc/server-kit';
import { buildApp, SERVICE } from './app.ts';
import { connectDatabase } from './infrastructure/db/client.ts';
import { DrizzleLeadRepository } from './infrastructure/db/drizzle-lead-repository.ts';

const config = loadConfigOrExit(intakeEnv);
const { logger, flush } = createLogger({
  service: SERVICE,
  level: config.LOG_LEVEL,
  pretty: config.LOG_PRETTY,
  betterStack: {
    sourceToken: config.BETTERSTACK_SOURCE_TOKEN,
    ingestingHost: config.BETTERSTACK_INGESTING_HOST,
  },
});

const database = connectDatabase(config.DATABASE_URL);
const app = buildApp({
  config,
  logger,
  version: serviceVersion(config),
  store: new DrizzleLeadRepository(database.db),
  pingDatabase: database.ping,
});

try {
  await startServer(app, {
    host: config.HOST,
    port: config.PORT,
    onShutdown: async () => {
      await database.close();
      await flush();
    },
  });
} catch (err) {
  logger.fatal({ err, event: 'server.start_failed' }, 'failed to start');
  await flush();
  process.exit(1);
}
