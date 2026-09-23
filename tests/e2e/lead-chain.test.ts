/**
 * The whole chain over real HTTP: intake → figure-mock → chase → email.
 * Each service runs its production composition root on an ephemeral port; intake uses
 * PGlite with the real migrations. Only the email provider (Resend) is replaced, by a
 * recorder that honours idempotency keys the way Resend does.
 */
import { Writable } from 'node:stream';
import { PGlite } from '@electric-sql/pglite';
import { chaseEnv, emailEnv, figureMockEnv, intakeEnv, loadConfig } from '@heloc/config';
import { leadResultSchema, type LeadResult } from '@heloc/contracts';
import { createLogger } from '@heloc/logger';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp as buildChase } from '../../apps/chase/src/app.ts';
import { ProviderError, type EmailProvider } from '../../apps/email/src/application/send-email.ts';
import { buildApp as buildEmail } from '../../apps/email/src/app.ts';
import type { OutboundEmail } from '../../apps/email/src/domain/outbound-email.ts';
import { buildApp as buildFigure } from '../../apps/figure-mock/src/app.ts';
import { buildApp as buildIntake } from '../../apps/intake/src/app.ts';
import {
  DrizzleLeadRepository,
  type Database,
} from '../../apps/intake/src/infrastructure/db/drizzle-lead-repository.ts';
import * as schema from '../../apps/intake/src/infrastructure/db/schema.ts';

const silent = new Writable({ write: (_c, _e, cb) => cb() });
const logger = () => createLogger({ service: 'e2e', destination: silent }).logger;
const keys = { figure: 'f'.repeat(64), chase: 'c'.repeat(64), email: 'e'.repeat(64) };

class RecordingProvider implements EmailProvider {
  readonly name = 'recording';
  readonly delivered = new Map<string, { email: OutboundEmail; from: string }>();
  down = false;
  async send(email: OutboundEmail, from: string, { idempotencyKey }: { idempotencyKey?: string }) {
    if (this.down) throw new ProviderError('internal_server_error', 'resend: unavailable');
    const key = idempotencyKey ?? crypto.randomUUID();
    if (!this.delivered.has(key)) this.delivered.set(key, { email, from });
    return { messageId: `email_${[...this.delivered.keys()].indexOf(key) + 1}` };
  }
}

const provider = new RecordingProvider();
const servers: { close(): Promise<unknown> }[] = [];
let intakeUrl = '';

async function listen(app: ReturnType<typeof buildFigure>) {
  servers.push(app);
  return app.listen({ host: '127.0.0.1', port: 0 });
}

beforeAll(async () => {
  const emailUrl = await listen(
    buildEmail({
      config: loadConfig(emailEnv, {
        INTERNAL_API_KEY: keys.email,
        EMAIL_PROVIDER: 'console',
        EMAIL_FROM: 'HELOC Demo <noreply@linkerclaw.ai>',
      }),
      logger: logger(),
      version: 'e2e',
      provider,
    }),
  );
  const chaseUrl = await listen(
    buildChase({
      config: loadConfig(chaseEnv, {
        INTERNAL_API_KEY: keys.chase,
        EMAIL_SERVICE_URL: emailUrl,
        EMAIL_SERVICE_API_KEY: keys.email,
      }),
      logger: logger(),
      version: 'e2e',
    }),
  );
  const figureUrl = await listen(
    buildFigure({
      config: loadConfig(figureMockEnv, { INTERNAL_API_KEY: keys.figure }),
      logger: logger(),
      version: 'e2e',
    }),
  );

  const pg = new PGlite();
  await migrate(drizzle(pg), {
    migrationsFolder: new URL('../../apps/intake/drizzle', import.meta.url).pathname,
  });
  const db = drizzle(pg, { schema }) as unknown as Database;
  intakeUrl = await listen(
    buildIntake({
      config: loadConfig(intakeEnv, {
        DATABASE_URL: 'postgresql://unused:unused@localhost:5432/unused',
        FIGURE_API_URL: figureUrl,
        FIGURE_API_KEY: keys.figure,
        CHASE_API_URL: chaseUrl,
        CHASE_API_KEY: keys.chase,
        CORS_ORIGINS: 'http://localhost:3000',
        ALLOW_MOCK_OVERRIDE: 'true',
      }),
      logger: logger(),
      version: 'e2e',
      store: new DrizzleLeadRepository(db),
      pingDatabase: async () => {},
    }),
  );
});

afterAll(async () => {
  await Promise.all(servers.map((s) => s.close()));
});

beforeEach(() => {
  provider.delivered.clear();
  provider.down = false;
});

const quiz = {
  name: 'John Doe',
  email: 'user@linkerclaw.ai',
  phone: '+14155551234',
  property_state: 'CA',
  estimated_home_value: 800_000,
  mortgage_balance: 350_000,
  credit_band: '700-739',
  income_band: '150k-200k',
  purpose: 'home_improvement',
};

async function post(path: string, body?: object, headers: Record<string, string> = {}) {
  const res = await fetch(`${intakeUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  // Every intake response — success or 502 — must honour the published contract.
  return { status: res.status, body: leadResultSchema.parse(await res.json()) };
}

const eventTypes = (body: LeadResult) => (body.events ?? []).map((e) => e.type);

describe('lead chain over HTTP', () => {
  it('need-more-documents: chases the borrower with the spec email, exactly once', async () => {
    const { status, body } = await post('/v1/leads', quiz);
    expect(status).toBe(201);
    expect(body).toMatchObject({
      status: 'chase_sent',
      documents: [{ type: 'income_verification', reason: 'Income requires verification' }],
      chase: { status: 'sent' },
    });
    expect(eventTypes(body)).toEqual([
      'lead.created',
      'figure.requested',
      'figure.need_more_documents',
      'chase.created',
      'email.sent',
    ]);

    expect(provider.delivered.size).toBe(1);
    const [key, sent] = [...provider.delivered][0]!;
    expect(key).toMatch(/^chase:[0-9a-f-]{36}$/);
    expect(sent.from).toBe('HELOC Demo <noreply@linkerclaw.ai>');
    expect(sent.email).toMatchObject({
      to: 'user@linkerclaw.ai',
      subject: 'Additional documents required for your HELOC application',
    });
    expect(sent.email.text).toContain('Hi John,');
    expect(sent.email.text).toContain('- Proof of income');
  });

  it.each([
    ['approved', 'approved'],
    ['rejected', 'rejected'],
  ])('X-Mock-Outcome %s reaches Figure and ends %s without email', async (outcome, status) => {
    const { body } = await post('/v1/leads', quiz, { 'x-mock-outcome': outcome });
    expect(body.status).toBe(status);
    expect(provider.delivered.size).toBe(0);
  });

  it('recovers from an email outage by replay without sending twice', async () => {
    provider.down = true;
    const failed = await post('/v1/leads', quiz);
    expect(failed.status).toBe(502);
    expect(failed.body).toMatchObject({ status: 'failed', chase: { status: 'failed' } });
    expect(failed.body.error).toContain('email_unavailable');

    provider.down = false;
    const replayed = await post(`/v1/leads/${failed.body.lead_id}/replay`);
    expect(replayed.status).toBe(200);
    expect(replayed.body.status).toBe('chase_sent');

    const again = await post(`/v1/leads/${failed.body.lead_id}/replay`);
    expect(again.body.status).toBe('chase_sent');
    expect(provider.delivered.size).toBe(1);
    expect(eventTypes(again.body).filter((t) => t === 'figure.requested')).toHaveLength(1);
  });

  it('recovers from a Figure outage by replay', async () => {
    const failed = await post(
      '/v1/leads',
      { ...quiz, credit_band: '780+' },
      { 'x-mock-fault': 'error' },
    );
    expect(failed.status).toBe(502);
    expect(failed.body.status).toBe('failed');

    const replayed = await post(`/v1/leads/${failed.body.lead_id}/replay`);
    expect(replayed.body).toMatchObject({ status: 'approved', offer: { lender: 'Figure mock' } });
  });
});
