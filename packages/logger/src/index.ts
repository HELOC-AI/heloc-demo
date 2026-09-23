import { Writable } from 'node:stream';
import { Logtail } from '@logtail/node';
import pino, { type DestinationStream, type Logger, type StreamEntry } from 'pino';
import pretty from 'pino-pretty';

export type { Logger } from 'pino';

export interface LoggerOptions {
  service: string;
  level?: string;
  /** Human-readable output for local dev. */
  pretty?: boolean;
  /** Ship logs to Better Stack in addition to stdout; no-op without a source token. */
  betterStack?: { sourceToken?: string | undefined; ingestingHost?: string | undefined };
  /** Override stdout (tests). */
  destination?: DestinationStream;
}

export interface ServiceLogger {
  logger: Logger;
  /** Flush buffered Better Stack logs; call before exit. */
  flush: () => Promise<void>;
}

/**
 * Secrets and borrower PII never reach log storage. Business logs identify a borrower
 * by lead_id only (docs/CONFIGURATION.md §4.2).
 */
export const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers["x-api-key"]',
  'headers.authorization',
  '*.headers.authorization',
  'apiKey',
  '*.apiKey',
  'api_key',
  '*.api_key',
  'password',
  '*.password',
  'email',
  '*.email',
  'phone',
  '*.phone',
  'to',
  '*.to',
];

export function createLogger(options: LoggerOptions): ServiceLogger {
  const level = options.level ?? 'info';
  const streams: StreamEntry[] = [
    {
      level: 'trace',
      stream:
        options.destination ??
        (options.pretty ? pretty({ colorize: true, sync: true }) : pino.destination(1)),
    },
  ];

  let logtail: Logtail | undefined;
  const { sourceToken, ingestingHost } = options.betterStack ?? {};
  if (sourceToken) {
    logtail = new Logtail(
      sourceToken,
      ingestingHost ? { endpoint: `https://${ingestingHost}` } : {},
    );
    streams.push({ level: 'trace', stream: betterStackStream(logtail) });
  }

  const logger = pino(
    {
      level,
      base: { service: options.service },
      messageKey: 'msg',
      timestamp: () => `,"timestamp":"${new Date().toISOString()}"`,
      formatters: { level: (label) => ({ level: label }) },
      redact: { paths: REDACT_PATHS, censor: '[redacted]' },
    },
    pino.multistream(streams),
  );

  return {
    logger,
    flush: async () => {
      await logtail?.flush();
    },
  };
}

/** Converts pino JSON lines into Better Stack log records. */
function betterStackStream(logtail: Logtail): Writable {
  return new Writable({
    write(chunk: Buffer, _encoding, callback) {
      try {
        const { msg, level, timestamp, ...context } = JSON.parse(chunk.toString());
        // Fire-and-forget: @logtail/node batches and retries internally.
        void logtail.log(msg ?? '', level, { ...context, dt: timestamp }).catch(() => {});
      } catch {
        // Never let log shipping take the service down.
      }
      callback();
    },
  });
}
