/**
 * Structured JSON logs, same shape as the other services:
 * `{ level, service, event, request_id, message, ... }`.
 *
 * Each entry goes to the console (Workers Logs / `wrangler tail`) and, when configured, to
 * Better Stack over HTTP. Shipping is fire-and-forget through `waitUntil`, so it never delays or
 * fails email handling.
 *
 * PII rule: never log attachment contents, filenames, subjects or the sender's full address —
 * callers log the sender's domain only.
 */

export const SERVICE = 'email-inbound';

export type LogLevel = 'info' | 'warn' | 'error';
export type LogFields = Record<string, unknown>;

export interface Logger {
  info(event: string, message: string, fields?: LogFields): void;
  warn(event: string, message: string, fields?: LogFields): void;
  error(event: string, message: string, fields?: LogFields): void;
}

export interface LoggerOptions {
  requestId: string;
  betterStack?: { ingestingHost?: string | undefined; sourceToken?: string | undefined };
  waitUntil: (promise: Promise<unknown>) => void;
  fetch?: typeof fetch;
  console?: Pick<Console, 'log' | 'warn' | 'error'>;
  now?: () => Date;
}

export function createLogger(options: LoggerOptions): Logger {
  const out = options.console ?? console;
  const doFetch = options.fetch ?? fetch;
  const now = options.now ?? (() => new Date());
  const { ingestingHost, sourceToken } = options.betterStack ?? {};

  const write = (level: LogLevel, event: string, message: string, fields: LogFields = {}) => {
    const entry = {
      ...fields,
      dt: now().toISOString(),
      level,
      service: SERVICE,
      event,
      request_id: options.requestId,
      message,
    };
    const line = JSON.stringify(entry);
    if (level === 'error') out.error(line);
    else if (level === 'warn') out.warn(line);
    else out.log(line);

    if (ingestingHost && sourceToken) {
      options.waitUntil(
        doFetch(`https://${ingestingHost}`, {
          method: 'POST',
          headers: { authorization: `Bearer ${sourceToken}`, 'content-type': 'application/json' },
          body: line,
        }).catch(() => undefined),
      );
    }
  };

  return {
    info: (event, message, fields) => write('info', event, message, fields),
    warn: (event, message, fields) => write('warn', event, message, fields),
    error: (event, message, fields) => write('error', event, message, fields),
  };
}
