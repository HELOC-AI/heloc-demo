import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { HEADERS, type HealthResponse } from '@heloc/contracts';
import type { Logger } from '@heloc/logger';
import Fastify, {
  LogController,
  type FastifyBaseLogger,
  type FastifyInstance,
  type FastifyRequest,
} from 'fastify';
import { HttpError } from './errors.ts';

export type HealthCheck = () => Promise<unknown>;

export interface ServerOptions {
  service: string;
  version: string;
  logger: Logger;
  /** Dependency probes reported under `checks`; any failure → 503 "degraded". */
  healthChecks?: Record<string, HealthCheck>;
  healthCheckTimeoutMs?: number;
}

const REQUEST_ID_PATTERN = /^[\w.:-]{1,128}$/;

export function createServer(options: ServerOptions): FastifyInstance {
  const { service, version, logger, healthChecks = {}, healthCheckTimeoutMs = 2000 } = options;

  const app = Fastify({
    // pino's Logger is a FastifyBaseLogger; the cast keeps FastifyInstance's default generics.
    loggerInstance: logger as FastifyBaseLogger,
    logController: new LogController({
      requestIdLogLabel: 'request_id',
      // Uptime monitors hit /health every few seconds; don't flood the log store.
      disableRequestLogging: (req) => req.url === '/health',
    }),
    // Reuse the caller's request id so one id follows a lead across services.
    genReqId: (req) => {
      const incoming = req.headers[HEADERS.requestId];
      return typeof incoming === 'string' && REQUEST_ID_PATTERN.test(incoming)
        ? incoming
        : randomUUID();
    },
  });

  app.addHook('onSend', async (request, reply) => {
    reply.header(HEADERS.requestId, request.id);
  });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof HttpError) {
      return reply.code(error.statusCode).send({
        error: error.code,
        message: error.message,
        request_id: request.id,
        details: error.details,
      });
    }
    const err = error as { statusCode?: number; code?: string; message?: string };
    // Fastify's own client errors (malformed JSON, wrong content type, body too large).
    if (err.statusCode && err.statusCode < 500) {
      return reply.code(err.statusCode).send({
        error: err.code ?? 'bad_request',
        message: err.message ?? 'Bad request',
        request_id: request.id,
      });
    }
    request.log.error({ err: error, event: 'http.unhandled_error' }, 'unhandled error');
    return reply.code(500).send({
      error: 'internal_error',
      message: 'Internal server error',
      request_id: request.id,
    });
  });

  app.setNotFoundHandler((request, reply) =>
    reply
      .code(404)
      .send({ error: 'not_found', message: 'Route not found', request_id: request.id }),
  );

  app.get('/health', async (_request, reply) => {
    const entries = await Promise.all(
      Object.entries(healthChecks).map(async ([name, check]) => {
        try {
          await withTimeout(check(), healthCheckTimeoutMs);
          return [name, 'ok'] as const;
        } catch (err) {
          logger.warn({ err, check: name, event: 'health.check_failed' }, 'health check failed');
          return [name, 'fail'] as const;
        }
      }),
    );
    const healthy = entries.every(([, result]) => result === 'ok');
    const body: HealthResponse = {
      status: healthy ? 'ok' : 'degraded',
      service,
      version,
      timestamp: new Date().toISOString(),
      ...(entries.length > 0 && { checks: Object.fromEntries(entries) }),
    };
    return reply.code(healthy ? 200 : 503).send(body);
  });

  return app;
}

/**
 * onRequest hook for service-to-service calls: `Authorization: Bearer <INTERNAL_API_KEY>`.
 * Compares SHA-256 digests so the check is constant-time regardless of input length.
 */
export function bearerAuth(expectedKey: string) {
  const expected = sha256(expectedKey);
  return async (request: FastifyRequest) => {
    const header = request.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : '';
    if (!token || !timingSafeEqual(sha256(token), expected)) {
      throw new HttpError(401, 'unauthorized', 'Missing or invalid API key');
    }
  };
}

export interface StartOptions {
  host: string;
  port: number;
  /** Runs after the server stops accepting requests, e.g. DB pool close, log flush. */
  onShutdown?: () => Promise<void>;
}

export async function startServer(app: FastifyInstance, options: StartOptions): Promise<void> {
  const shutdown = async (signal: string) => {
    app.log.info({ event: 'server.shutdown', signal }, 'shutting down');
    try {
      await app.close();
      await options.onShutdown?.();
    } finally {
      process.exit(0);
    }
  };
  process.once('SIGTERM', () => void shutdown('SIGTERM'));
  process.once('SIGINT', () => void shutdown('SIGINT'));

  await app.listen({ host: options.host, port: options.port });
}

const sha256 = (value: string) => createHash('sha256').update(value).digest();

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
