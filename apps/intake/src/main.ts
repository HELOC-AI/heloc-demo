import { intakeEnv, loadConfigOrExit, serviceVersion } from '@heloc/config';
import { createLogger } from '@heloc/logger';
import { createErrorReporter, startServer } from '@heloc/server-kit';
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
const errorReporter = createErrorReporter({
  dsn: config.BETTERSTACK_ERRORS_DSN,
  service: SERVICE,
  release: serviceVersion(config),
  environment: config.RAILWAY_ENVIRONMENT_NAME ?? 'development',
});

const database = connectDatabase(config.DATABASE_URL);
const app = buildApp({
  config,
  logger,
  version: serviceVersion(config),
  errorReporter,
  store: new DrizzleLeadRepository(database.db),
  pingDatabase: database.ping,
});

try {
  await startServer(app, {
    host: config.HOST,
    port: config.PORT,
    onShutdown: async () => {
      await database.close();
      await errorReporter.flush();
      await flush();
    },
  });
} catch (err) {
  logger.fatal({ err, event: 'server.start_failed' }, 'failed to start');
  errorReporter.capture(err, { event: 'server.start_failed' });
  await Promise.all([errorReporter.flush(), flush()]);
  process.exit(1);
}
