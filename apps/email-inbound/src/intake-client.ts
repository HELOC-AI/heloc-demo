/**
 * Client for Lead Intake's `POST /v1/inbound-emails`.
 *
 * Outcomes:
 * - 2xx → `delivered` (Intake decided; `accepted: false` is still a final answer).
 * - 400/413/422 (and other 4xx) → `refused`: the payload itself is wrong, retrying the same
 *   email cannot succeed.
 * - 5xx, 401, 403, 404, 408, 429, network error, timeout → throws `IntakeUnavailableError`
 *   so the caller signals a temporary failure and the sending mail server retries later.
 *   401/403/404 here mean *our* misconfiguration (wrong key, endpoint not deployed yet) —
 *   the borrower's reply must survive until it is fixed, not bounce.
 */
import {
  errorResponseSchema,
  type InboundEmail,
  type InboundEmailResponse,
  inboundEmailResponseSchema,
} from '@heloc/contracts';

const TEMPORARY_STATUSES = new Set([401, 403, 404, 408, 429]);

export const INBOUND_EMAILS_PATH = '/v1/inbound-emails';
export const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_ERROR_MESSAGE_LENGTH = 300;

export interface IntakeClientOptions {
  baseUrl: string;
  apiKey: string;
  timeoutMs?: number;
  fetch?: typeof fetch;
}

export type ForwardOutcome =
  | { kind: 'delivered'; status: number; response: InboundEmailResponse | undefined }
  | { kind: 'refused'; status: number; error: string | undefined; message: string | undefined };

export class IntakeUnavailableError extends Error {
  override readonly name = 'IntakeUnavailableError';
  readonly status: number | undefined;
  constructor(message: string, status?: number) {
    super(message);
    this.status = status;
  }
}

export async function forwardInboundEmail(
  email: InboundEmail,
  requestId: string,
  options: IntakeClientOptions,
): Promise<ForwardOutcome> {
  const doFetch = options.fetch ?? fetch;
  const url = `${options.baseUrl.replace(/\/+$/, '')}${INBOUND_EMAILS_PATH}`;

  let res: Response;
  try {
    res = await doFetch(url, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${options.apiKey}`,
        'content-type': 'application/json',
        'x-request-id': requestId,
      },
      body: JSON.stringify(email),
      signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
  } catch (err) {
    const reason = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    throw new IntakeUnavailableError(`intake unreachable (${reason})`);
  }

  const body: unknown = await res.json().catch(() => undefined);

  if (res.ok) {
    const parsed = inboundEmailResponseSchema.safeParse(body);
    return {
      kind: 'delivered',
      status: res.status,
      response: parsed.success ? parsed.data : undefined,
    };
  }
  if (res.status >= 500 || TEMPORARY_STATUSES.has(res.status)) {
    throw new IntakeUnavailableError(`intake responded ${res.status}`, res.status);
  }
  const error = errorResponseSchema.safeParse(body);
  return {
    kind: 'refused',
    status: res.status,
    error: error.success ? error.data.error : undefined,
    message: error.success ? error.data.message.slice(0, MAX_ERROR_MESSAGE_LENGTH) : undefined,
  };
}
