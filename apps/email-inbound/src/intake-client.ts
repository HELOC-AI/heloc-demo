/**
 * Client for Lead Intake's `POST /v1/inbound-emails`.
 *
 * Outcomes:
 * - 2xx → `delivered` (Intake decided; `accepted: false` is still a final answer).
 * - 4xx (except 408/429) → `refused`: permanent, retrying the same payload cannot succeed.
 * - 5xx, 408, 429, network error, timeout → throws `IntakeUnavailableError` so the caller can
 *   signal a temporary failure and have the sending mail server retry later.
 */
import {
  errorResponseSchema,
  type InboundEmail,
  type InboundEmailResponse,
  inboundEmailResponseSchema,
} from '@heloc/contracts';

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
  if (res.status >= 500 || res.status === 408 || res.status === 429) {
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
