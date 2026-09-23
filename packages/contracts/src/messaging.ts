import { z } from 'zod';
import { missingDocumentSchema } from './figure.ts';

// intake → chase

export const chaseRequestSchema = z.object({
  /** Created by intake before calling chase; drives the email idempotency key. */
  chase_id: z.uuid(),
  lead_id: z.uuid(),
  email: z.email(),
  name: z.string().min(1),
  missing_documents: z.array(missingDocumentSchema).min(1),
});
export type ChaseRequest = z.infer<typeof chaseRequestSchema>;

export const chaseResponseSchema = z.object({
  chase_id: z.uuid(),
  status: z.literal('sent'),
  subject: z.string(),
  body: z.string(),
  email_message_id: z.string(),
});
export type ChaseResponse = z.infer<typeof chaseResponseSchema>;

export const chaseIdempotencyKey = (chaseId: string) => `chase:${chaseId}`;

// chase → email

export const sendEmailRequestSchema = z.object({
  to: z.email(),
  subject: z.string().min(1).max(998),
  html: z.string().min(1),
  text: z.string().min(1),
});
export type SendEmailRequest = z.infer<typeof sendEmailRequestSchema>;

export const sendEmailResponseSchema = z.object({
  message_id: z.string(),
  status: z.literal('accepted'),
});
export type SendEmailResponse = z.infer<typeof sendEmailResponseSchema>;
