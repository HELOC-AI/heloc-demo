import 'server-only';
import { serviceUrlsFrom, type OverviewConfig } from '@heloc/ops';
import { API_URL } from './env.ts';

/**
 * Where /ops reads from, built from server-only env. OPS_API_KEY and the Better Stack query
 * credentials are secrets: they stay on the server; only the rendered overview reaches the browser.
 */
export function opsConfig(env: Record<string, string | undefined> = process.env): OverviewConfig {
  const { OPS_API_KEY, BETTERSTACK_QUERY_HOST, BETTERSTACK_QUERY_USERNAME } = env;
  const password = env.BETTERSTACK_QUERY_PASSWORD;
  return {
    // The intake the browser talks to, unless the server is told otherwise.
    urls: serviceUrlsFrom({ ...env, INTAKE_URL: env.INTAKE_URL || API_URL }),
    opsApiKey: OPS_API_KEY || undefined,
    query:
      BETTERSTACK_QUERY_HOST && BETTERSTACK_QUERY_USERNAME && password
        ? { host: BETTERSTACK_QUERY_HOST, username: BETTERSTACK_QUERY_USERNAME, password }
        : undefined,
  };
}
