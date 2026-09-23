import { z } from 'zod';

export const healthResponseSchema = z.object({
  status: z.enum(['ok', 'degraded']),
  service: z.string(),
  version: z.string(),
  timestamp: z.iso.datetime(),
  checks: z.record(z.string(), z.enum(['ok', 'fail'])).optional(),
});
export type HealthResponse = z.infer<typeof healthResponseSchema>;

/** Error body returned by every service. */
export const errorResponseSchema = z.object({
  error: z.string(),
  message: z.string(),
  request_id: z.string().optional(),
  details: z.unknown().optional(),
});
export type ErrorResponse = z.infer<typeof errorResponseSchema>;
