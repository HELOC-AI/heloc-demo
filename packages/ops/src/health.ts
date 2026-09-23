import { healthResponseSchema } from '@heloc/contracts';

export interface HealthCheck {
  service: string;
  url: string;
  ok: boolean;
  /** HTTP status, when the service answered. */
  httpStatus?: number;
  version?: string;
  latencyMs: number;
  /** Why it is not ok. */
  error?: string;
  /** Dependency checks the service reports (intake: db). */
  checks?: Record<string, string>;
}

/** GET <url>/health (or `path`), as the uptime monitors do. */
export async function checkHealth(
  service: string,
  baseUrl: string,
  {
    path = '/health',
    timeoutMs = 5000,
    fetch: fetchFn = fetch,
  }: { path?: string; timeoutMs?: number; fetch?: typeof fetch } = {},
): Promise<HealthCheck> {
  const url = `${baseUrl.replace(/\/$/, '')}${path}`;
  const started = performance.now();
  const elapsed = () => Math.round(performance.now() - started);
  try {
    const response = await fetchFn(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (path !== '/health') {
      return {
        service,
        url,
        ok: response.ok,
        httpStatus: response.status,
        latencyMs: elapsed(),
        ...(!response.ok && { error: `HTTP ${response.status}` }),
      };
    }
    const parsed = healthResponseSchema.safeParse(await response.json().catch(() => undefined));
    const body = parsed.success ? parsed.data : undefined;
    const ok = response.ok && body?.status === 'ok';
    return {
      service,
      url,
      ok,
      httpStatus: response.status,
      latencyMs: elapsed(),
      ...(body?.version && { version: body.version }),
      ...(body?.checks && { checks: body.checks }),
      ...(!ok && { error: body ? `status ${body.status}` : `HTTP ${response.status}` }),
    };
  } catch (error) {
    const timedOut = error instanceof Error && error.name === 'TimeoutError';
    return {
      service,
      url,
      ok: false,
      latencyMs: elapsed(),
      error: timedOut
        ? `no answer within ${timeoutMs}ms`
        : String((error as Error).message ?? error),
    };
  }
}
