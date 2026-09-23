import type { ChaseConfig } from '@heloc/config';
import type { Logger } from '@heloc/logger';
import { bearerAuth, createServer, createServiceClient } from '@heloc/server-kit';
import { createSendChase, type Composer, type EmailGateway } from './application/send-chase.ts';
import { EmailHttpGateway } from './infrastructure/email-gateway.ts';
import { TemplateComposer } from './infrastructure/template-composer.ts';
import { chaseRoutes } from './interface/http/chase-routes.ts';

export const SERVICE = 'chase';

const EMAIL_TIMEOUT_MS = 8_000;

export interface AppDeps {
  config: ChaseConfig;
  logger: Logger;
  version: string;
  composer?: Composer;
  email?: EmailGateway;
}

/** Composition root. */
export function buildApp({ config, logger, version, composer, email }: AppDeps) {
  const sendChase = createSendChase({
    composer: composer ?? new TemplateComposer(),
    email:
      email ??
      new EmailHttpGateway(
        createServiceClient({
          service: 'email',
          baseUrl: config.EMAIL_SERVICE_URL,
          apiKey: config.EMAIL_SERVICE_API_KEY,
          timeoutMs: EMAIL_TIMEOUT_MS,
        }),
      ),
  });

  const app = createServer({ service: SERVICE, version, logger });
  app.register(
    async (v1) => {
      v1.addHook('onRequest', bearerAuth(config.INTERNAL_API_KEY));
      chaseRoutes(v1, { sendChase });
    },
    { prefix: '/v1' },
  );
  return app;
}
