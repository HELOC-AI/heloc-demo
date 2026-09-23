import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { errorResponseSchema } from './http.ts';
import { sendEmailRequestSchema, sendEmailResponseSchema } from './messaging.ts';

/**
 * chase is a consumer of heloc-email-service's Send API. email-service.send-api.json is a
 * pinned copy of that service's published contract (contract/send-api.json there);
 * `pnpm check:contracts` fails when the pinned copy falls behind the provider.
 */
const pinned = JSON.parse(
  readFileSync(new URL('./email-service.send-api.json', import.meta.url), 'utf8'),
);
const send = pinned.endpoints['POST /v1/send'];

describe('Send API (consumer copy vs heloc-email-service contract)', () => {
  it('sends exactly the request the Email Service accepts', () => {
    expect(z.toJSONSchema(sendEmailRequestSchema)).toEqual(send.request);
  });

  it('expects exactly the 202 response the Email Service returns', () => {
    expect(z.toJSONSchema(sendEmailResponseSchema)).toEqual(send.responses['202']);
  });

  it('requires only error fields the Email Service always returns', () => {
    const required = z.toJSONSchema(errorResponseSchema).required ?? [];
    for (const field of required) expect(send.responses['4xx/5xx'].required).toContain(field);
  });
});
