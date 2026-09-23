import type { EmailConfig } from '@heloc/config';
import type { Logger } from '@heloc/logger';
import { bearerAuth, createServer, type ErrorReporter } from '@heloc/server-kit';
import { createSendEmail, type EmailProvider } from './application/send-email.ts';
import { ConsoleProvider } from './infrastructure/console-provider.ts';
import { ResendProvider } from './infrastructure/resend-provider.ts';
import { sendRoutes } from './interface/http/send-routes.ts';

export const SERVICE = 'email';

export interface AppDeps {
  config: EmailConfig;
  logger: Logger;
  version: string;
  errorReporter?: ErrorReporter;
  provider?: EmailProvider;
}

/** Composition root. */
export function buildApp({ config, logger, version, errorReporter, provider }: AppDeps) {
  const emailProvider =
    provider ??
    (config.EMAIL_PROVIDER === 'resend'
      ? new ResendProvider(config.RESEND_API_KEY!)
      : new ConsoleProvider(logger));
  const sendEmail = createSendEmail({ provider: emailProvider, sender: config.EMAIL_FROM });

  const app = createServer({ service: SERVICE, version, logger, errorReporter });
  app.register(
    async (v1) => {
      v1.addHook('onRequest', bearerAuth(config.INTERNAL_API_KEY));
      sendRoutes(v1, { sendEmail });
    },
    { prefix: '/v1' },
  );
  return app;
}
