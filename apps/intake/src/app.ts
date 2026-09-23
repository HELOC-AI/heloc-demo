import { randomUUID } from 'node:crypto';
import cors from '@fastify/cors';
import { HEADERS } from '@heloc/contracts';
import type { IntakeConfig } from '@heloc/config';
import type { Logger } from '@heloc/logger';
import {
  bearerAuth,
  createServer,
  createServiceClient,
  type ErrorReporter,
} from '@heloc/server-kit';
import { createLeadUseCases } from './application/lead-use-cases.ts';
import type {
  ChaseGateway,
  Clock,
  IdGenerator,
  LeadTimeline,
  NoticeGateway,
  PrequalGateway,
} from './application/ports.ts';
import type { LeadRepository } from './domain/lead-repository.ts';
import { ChaseHttpGateway, OutcomeNoticeHttpGateway } from './infrastructure/http/chase-gateway.ts';
import { FigureHttpGateway } from './infrastructure/http/figure-gateway.ts';
import { inboundRoutes } from './interface/http/inbound-routes.ts';
import { leadRoutes } from './interface/http/lead-routes.ts';
import { opsRoutes } from './interface/http/ops-routes.ts';

export const SERVICE = 'intake';

const FIGURE_TIMEOUT_MS = 5_000;
const CHASE_TIMEOUT_MS = 10_000;

export interface AppDeps {
  config: IntakeConfig;
  logger: Logger;
  version: string;
  errorReporter?: ErrorReporter;
  /** Persistence adapter (Drizzle in production, PGlite / in-memory in tests). */
  store: LeadRepository & LeadTimeline;
  /** Liveness probe for the database, reported by /health. */
  pingDatabase: () => Promise<unknown>;
  prequal?: PrequalGateway;
  chases?: ChaseGateway;
  notices?: NoticeGateway;
  /** Tests: receives background work started by an accepted Chase Reply. */
  onBackground?: (work: Promise<unknown>) => void;
  clock?: Clock;
  ids?: IdGenerator;
}

/** Composition root: the only place that knows every layer. */
export function buildApp(deps: AppDeps) {
  const { config, logger, version, store } = deps;
  const clock = deps.clock ?? { now: () => new Date() };

  const prequal =
    deps.prequal ??
    new FigureHttpGateway(
      createServiceClient({
        service: 'figure-mock',
        baseUrl: config.FIGURE_API_URL,
        apiKey: config.FIGURE_API_KEY,
        timeoutMs: FIGURE_TIMEOUT_MS,
      }),
    );
  const chaseClient = createServiceClient({
    service: 'chase',
    baseUrl: config.CHASE_API_URL,
    apiKey: config.CHASE_API_KEY,
    timeoutMs: CHASE_TIMEOUT_MS,
  });
  const chases = deps.chases ?? new ChaseHttpGateway(chaseClient, clock);
  const notices = deps.notices ?? new OutcomeNoticeHttpGateway(chaseClient, clock);

  const useCases = createLeadUseCases({
    leads: store,
    timeline: store,
    prequal,
    chases,
    notices,
    clock,
    ids: deps.ids ?? { newId: randomUUID },
    resultUrl: (leadId) => `${config.WEB_APP_URL}/result/${leadId}`,
  });

  const app = createServer({
    service: SERVICE,
    version,
    logger,
    healthChecks: { db: deps.pingDatabase },
    errorReporter: deps.errorReporter,
  });

  // The quiz calls intake directly from the browser.
  app.register(cors, {
    origin: config.CORS_ORIGINS,
    methods: ['GET', 'POST'],
    allowedHeaders: ['content-type', HEADERS.requestId, HEADERS.mockOutcome, HEADERS.mockFault],
    exposedHeaders: [HEADERS.requestId],
  });

  app.register(
    async (v1) => leadRoutes(v1, { useCases, allowMockOverride: config.ALLOW_MOCK_OVERRIDE }),
    { prefix: '/v1' },
  );

  // Operator reads: the /ops page server and scripts/ops.ts.
  app.register(
    async (ops) => {
      ops.addHook('onRequest', bearerAuth(config.OPS_API_KEY));
      opsRoutes(ops, { useCases });
    },
    { prefix: '/v1' },
  );

  // Only the inbound email adapter may post received emails.
  app.register(
    async (inbound) => {
      inbound.addHook('onRequest', bearerAuth(config.INBOUND_API_KEY));
      inboundRoutes(inbound, { useCases, logger: app.log, onBackground: deps.onBackground });
    },
    { prefix: '/v1' },
  );

  return app;
}
