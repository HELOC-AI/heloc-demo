import type { FigureMockConfig } from '@heloc/config';
import type { Logger } from '@heloc/logger';
import { bearerAuth, createServer } from '@heloc/server-kit';

export const SERVICE = 'figure-mock';

export interface AppDeps {
  config: FigureMockConfig;
  logger: Logger;
  version: string;
}

export function buildApp({ config, logger, version }: AppDeps) {
  const app = createServer({ service: SERVICE, version, logger });

  app.register(
    async (v1) => {
      v1.addHook('onRequest', bearerAuth(config.INTERNAL_API_KEY));
    },
    { prefix: '/v1' },
  );

  return app;
}
