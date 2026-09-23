import * as Sentry from '@sentry/node';

/**
 * Unexpected exceptions go to Better Stack Errors, which speaks the Sentry protocol
 * (docs/DEV-PLAN.md §1 #12). Expected failures — a dependency timing out, invalid input —
 * are handled and logged, not reported here.
 */
export interface ErrorReporter {
  capture(error: unknown, context?: Record<string, string | number | undefined>): void;
  flush(): Promise<void>;
}

export interface ErrorReporterOptions {
  /** Better Stack Errors DSN; without it reporting is a no-op (local dev, tests). */
  dsn?: string | undefined;
  service: string;
  release: string;
  environment: string;
}

export const noopErrorReporter: ErrorReporter = {
  capture: () => {},
  flush: async () => {},
};

export function createErrorReporter(options: ErrorReporterOptions): ErrorReporter {
  if (!options.dsn) return noopErrorReporter;

  Sentry.init({
    dsn: options.dsn,
    release: `${options.service}@${options.release}`,
    environment: options.environment,
    serverName: options.service,
    sendDefaultPii: false,
    tracesSampleRate: 0,
    // Error capture only: no auto-instrumentation, so no ESM preload is needed.
    defaultIntegrations: false,
    integrations: [
      Sentry.onUncaughtExceptionIntegration(),
      Sentry.onUnhandledRejectionIntegration(),
      Sentry.linkedErrorsIntegration(),
      Sentry.contextLinesIntegration(),
      Sentry.nodeContextIntegration(),
    ],
    initialScope: { tags: { service: options.service } },
  });

  return {
    capture(error, context = {}) {
      Sentry.withScope((scope) => {
        for (const [key, value] of Object.entries(context)) {
          if (value !== undefined) scope.setTag(key, String(value));
        }
        Sentry.captureException(error);
      });
    },
    async flush() {
      await Sentry.flush(2_000);
    },
  };
}
