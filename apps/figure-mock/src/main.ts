import { figureMockEnv, loadConfigOrExit, serviceVersion } from '@heloc/config';
import { createLogger } from '@heloc/logger';
import { createErrorReporter, startServer } from '@heloc/server-kit';
import { buildApp, SERVICE } from './app.ts';

const config = loadConfigOrExit(figureMockEnv);
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

const app = buildApp({ config, logger, version: serviceVersion(config), errorReporter });
try {
  await startServer(app, {
    host: config.HOST,
    port: config.PORT,
    onShutdown: async () => {
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
