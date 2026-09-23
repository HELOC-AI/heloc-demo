import type { FigureMockConfig } from '@heloc/config';
import type { Logger } from '@heloc/logger';
import { bearerAuth, createServer, type ErrorReporter } from '@heloc/server-kit';
import type { Clock } from './application/run-soft-pull.ts';
import { softPullRoutes } from './interface/http/routes.ts';

export const SERVICE = 'figure-mock';

export interface AppDeps {
  config: FigureMockConfig;
  logger: Logger;
  version: string;
  errorReporter?: ErrorReporter;
  clock?: Clock;
  faultDelayMs?: number;
}

/** Composition root. */
export function buildApp({
  config,
  logger,
  version,
  errorReporter,
  clock = { now: () => new Date() },
  faultDelayMs = 30_000,
}: AppDeps) {
  const app = createServer({ service: SERVICE, version, logger, errorReporter });

  app.register(
    async (v1) => {
      v1.addHook('onRequest', bearerAuth(config.INTERNAL_API_KEY));
      softPullRoutes(v1, { clock, faultDelayMs });
    },
    { prefix: '/v1' },
  );

  return app;
}
