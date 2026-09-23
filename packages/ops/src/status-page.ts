import { z } from 'zod';
import { STATUS_PAGE_URL } from './catalog.ts';

const dayStatus = z.enum(['operational', 'downtime', 'degraded', 'maintenance', 'not_monitored']);

const statusPageJson = z.object({
  data: z.object({
    attributes: z.object({ aggregate_state: z.string() }),
  }),
  included: z.array(
    z.object({
      type: z.string(),
      attributes: z.looseObject({
        public_name: z.string().optional(),
        position: z.number().optional(),
        status: z.string().optional(),
        availability: z.number().optional(),
        status_history: z
          .array(
            z.object({
              day: z.string(),
              status: z.union([dayStatus, z.string()]),
              downtime_duration: z.number(),
            }),
          )
          .optional(),
      }),
    }),
  ),
});

export interface StatusPageResource {
  name: string;
  status: string;
  /** 0–1 over the page's history window (30 days). */
  availability: number;
  history: { day: string; status: string; downtimeSeconds: number }[];
}

export interface StatusPage {
  url: string;
  state: string;
  resources: StatusPageResource[];
}

/** Uptime history from the public status page (no credentials needed). */
export async function readStatusPage({
  url = STATUS_PAGE_URL,
  timeoutMs = 8000,
  fetch: fetchFn = fetch,
} = {}): Promise<StatusPage> {
  const response = await fetchFn(`${url}/index.json`, { signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) throw new Error(`status page: HTTP ${response.status}`);
  const json = statusPageJson.parse(await response.json());
  return {
    url,
    state: json.data.attributes.aggregate_state,
    resources: json.included
      .filter((i) => i.type === 'status_page_resource')
      .sort((a, b) => (a.attributes.position ?? 0) - (b.attributes.position ?? 0))
      .map(({ attributes: r }) => ({
        name: r.public_name ?? 'unknown',
        status: r.status ?? 'unknown',
        availability: r.availability ?? 0,
        history: (r.status_history ?? []).map((d) => ({
          day: d.day,
          status: d.status,
          downtimeSeconds: d.downtime_duration,
        })),
      })),
  };
}
