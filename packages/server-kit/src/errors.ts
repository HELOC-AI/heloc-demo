import type { z } from 'zod';

/** An error with a deliberate HTTP status and machine-readable code. */
export class HttpError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly details: unknown;

  constructor(statusCode: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'HttpError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

/** Validate untrusted input; failures become a 400 listing the offending fields. */
export function parseInput<S extends z.ZodType>(schema: S, data: unknown): z.output<S> {
  const result = schema.safeParse(data);
  if (result.success) return result.data;
  throw new HttpError(
    400,
    'invalid_request',
    'Request validation failed',
    result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
  );
}
