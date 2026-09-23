import { HEADERS } from '@heloc/contracts';
import type { z } from 'zod';

export type UpstreamFailure = 'timeout' | 'network' | 'http' | 'invalid_response';

/** A call to another service failed; `kind` tells the caller whether a retry makes sense. */
export class UpstreamError extends Error {
  readonly service: string;
  readonly kind: UpstreamFailure;
  readonly status: number | undefined;

  constructor(service: string, kind: UpstreamFailure, message: string, status?: number) {
    super(`${service}: ${message}`);
    this.name = 'UpstreamError';
    this.service = service;
    this.kind = kind;
    this.status = status;
  }
}

export interface ServiceClientOptions {
  /** Name used in errors and logs, e.g. "figure-mock". */
  service: string;
  baseUrl: string;
  apiKey: string;
  timeoutMs: number;
  fetch?: typeof fetch;
}

export interface PostOptions<S extends z.ZodType> {
  responseSchema: S;
  requestId?: string | undefined;
  headers?: Record<string, string | undefined>;
}

export type ServiceClient = ReturnType<typeof createServiceClient>;

/** JSON-over-HTTP client for internal calls: bearer auth, timeout, request-id propagation. */
export function createServiceClient(options: ServiceClientOptions) {
  const doFetch = options.fetch ?? fetch;

  return {
    async post<S extends z.ZodType>(
      path: string,
      body: unknown,
      { responseSchema, requestId, headers = {} }: PostOptions<S>,
    ): Promise<z.output<S>> {
      const definedHeaders = Object.fromEntries(
        Object.entries(headers).filter(
          (entry): entry is [string, string] => entry[1] !== undefined,
        ),
      );
      let response: Response;
      try {
        response = await doFetch(`${options.baseUrl}${path}`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${options.apiKey}`,
            ...(requestId && { [HEADERS.requestId]: requestId }),
            ...definedHeaders,
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(options.timeoutMs),
        });
      } catch (err) {
        if (err instanceof DOMException && err.name === 'TimeoutError') {
          throw new UpstreamError(
            options.service,
            'timeout',
            `timed out after ${options.timeoutMs}ms`,
          );
        }
        throw new UpstreamError(options.service, 'network', (err as Error).message);
      }

      const text = await response.text();
      if (!response.ok) {
        throw new UpstreamError(
          options.service,
          'http',
          `HTTP ${response.status}: ${text.slice(0, 500)}`,
          response.status,
        );
      }

      let json: unknown;
      try {
        json = JSON.parse(text);
      } catch {
        throw new UpstreamError(options.service, 'invalid_response', 'response is not JSON');
      }
      const parsed = responseSchema.safeParse(json);
      if (!parsed.success) {
        throw new UpstreamError(
          options.service,
          'invalid_response',
          `unexpected response shape: ${parsed.error.message.slice(0, 500)}`,
        );
      }
      return parsed.data;
    },
  };
}
