import {
  HEADERS,
  leadResultSchema,
  type LeadInput,
  type LeadResult,
  type MockOutcome,
} from '@heloc/contracts';
import { API_URL } from './env.ts';
import { fieldErrorsFromDetails, type FieldErrors } from './lead-form.ts';

/**
 * Outcome of a call to Lead Intake. A `failed` Lead still arrives as `lead`: intake
 * persists it and answers 502, and the result page offers Replay.
 */
export type ApiResult =
  | { kind: 'lead'; lead: LeadResult }
  | { kind: 'invalid'; errors: FieldErrors; messages: string[] }
  | { kind: 'not_found' }
  | { kind: 'conflict' }
  | { kind: 'error'; message: string };

export interface SubmitOptions {
  /** Forces Figure's Prequal Decision (demo only); omitted → underwriting rules apply. */
  mockOutcome?: MockOutcome | undefined;
}

export interface LeadApi {
  submitLead(input: LeadInput, options?: SubmitOptions): Promise<ApiResult>;
  getLead(leadId: string): Promise<ApiResult>;
  replayLead(leadId: string): Promise<ApiResult>;
}

export function createLeadApi(
  baseUrl: string,
  fetchImpl: typeof fetch = (...args) => fetch(...args),
): LeadApi {
  async function call(
    path: string,
    init: { method: string; body?: unknown; headers?: Record<string, string> },
  ) {
    const headers: Record<string, string> = { accept: 'application/json', ...init.headers };
    // Only send content-type with a body: an empty JSON body is a 400 in Fastify.
    if (init.body !== undefined) headers['content-type'] = 'application/json';
    let response: Response;
    try {
      response = await fetchImpl(`${baseUrl}${path}`, {
        method: init.method,
        headers,
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
        cache: 'no-store',
      });
    } catch {
      return networkError();
    }
    return interpret(response);
  }

  const leadPath = (leadId: string) => `/v1/leads/${encodeURIComponent(leadId)}`;
  const notFound = async (): Promise<ApiResult> => ({ kind: 'not_found' });

  return {
    submitLead: (input, { mockOutcome } = {}) =>
      call('/v1/leads', {
        method: 'POST',
        body: input,
        headers: mockOutcome ? { [HEADERS.mockOutcome]: mockOutcome } : {},
      }),
    // Lead ids are UUIDs; anything else cannot exist, so there is no need to ask intake.
    getLead: (leadId) =>
      isLeadId(leadId) ? call(leadPath(leadId), { method: 'GET' }) : notFound(),
    replayLead: (leadId) =>
      isLeadId(leadId) ? call(`${leadPath(leadId)}/replay`, { method: 'POST' }) : notFound(),
  };
}

async function interpret(response: Response): Promise<ApiResult> {
  const body: unknown = await response.json().catch(() => undefined);

  // 200/201 carry a LeadResult; so does 502, whose Lead is persisted but `failed`.
  if (response.ok || response.status === 502) {
    const parsed = leadResultSchema.safeParse(body);
    if (parsed.success) return { kind: 'lead', lead: parsed.data };
  }
  if (response.status === 400) {
    const { errors, rest } = fieldErrorsFromDetails((body as { details?: unknown })?.details);
    return { kind: 'invalid', errors, messages: rest };
  }
  if (response.status === 404) return { kind: 'not_found' };
  if (response.status === 409) return { kind: 'conflict' };
  return {
    kind: 'error',
    message: `Something went wrong on our side (HTTP ${response.status}). Please try again.`,
  };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isLeadId(value: string): boolean {
  return UUID.test(value);
}

function networkError(): ApiResult {
  return {
    kind: 'error',
    message: "We couldn't reach our servers. Check your connection and try again.",
  };
}

export const leadApi = createLeadApi(API_URL);
