import { intakeEnv, loadConfigOrExit, serviceVersion } from '@heloc/config';
import { createLogger } from '@heloc/logger';
import { startServer } from '@heloc/server-kit';
import { buildApp, SERVICE } from './app.ts';

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

const app = buildApp({ config, logger, version: serviceVersion(config) });
try {
  await startServer(app, { host: config.HOST, port: config.PORT, onShutdown: flush });
} catch (err) {
  logger.fatal({ err, event: 'server.start_failed' }, 'failed to start');
  await flush();
  process.exit(1);
}
