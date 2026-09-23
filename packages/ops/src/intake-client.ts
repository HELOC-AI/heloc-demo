import {
  leadResultSchema,
  opsLeadsResponseSchema,
  type LeadResult,
  type OpsLeadsResponse,
} from '@heloc/contracts';

export type AttentionLead = OpsLeadsResponse['leads'][number];

/** intake as an operator sees it: GET /v1/ops/* (OPS_API_KEY) plus the public Lead API. */
export function createIntakeOpsClient(
  { url, opsApiKey }: { url: string; opsApiKey?: string | undefined },
  { timeoutMs = 10_000, fetch: fetchFn = fetch } = {},
) {
  const base = url.replace(/\/$/, '');
  async function call(path: string, init: RequestInit = {}) {
    const response = await fetchFn(`${base}${path}`, {
      ...init,
      signal: AbortSignal.timeout(timeoutMs),
    });
    const body = await response.json().catch(() => undefined);
    return { status: response.status, ok: response.ok, body };
  }
  return {
    /** Failed Leads and Leads stuck mid-pipeline, newest first. */
    async leadsNeedingAttention(limit = 50): Promise<AttentionLead[]> {
      if (!opsApiKey) throw new Error('OPS_API_KEY is not configured');
      const res = await call(`/v1/ops/leads?limit=${limit}`, {
        headers: { authorization: `Bearer ${opsApiKey}` },
      });
      if (!res.ok) throw new Error(`intake GET /v1/ops/leads → HTTP ${res.status}`);
      return opsLeadsResponseSchema.parse(res.body).leads;
    },
    async lead(leadId: string): Promise<LeadResult | undefined> {
      const res = await call(`/v1/leads/${encodeURIComponent(leadId)}`);
      if (res.status === 404) return undefined;
      if (!res.ok) throw new Error(`intake GET /v1/leads/${leadId} → HTTP ${res.status}`);
      return leadResultSchema.parse(res.body);
    },
    /** Resumes a failed Lead from its failed step. Returns intake's answer as-is. */
    async replay(leadId: string): Promise<{ status: number; body: unknown }> {
      const res = await call(`/v1/leads/${encodeURIComponent(leadId)}/replay`, { method: 'POST' });
      return { status: res.status, body: res.body };
    },
  };
}
export type IntakeOpsClient = ReturnType<typeof createIntakeOpsClient>;
