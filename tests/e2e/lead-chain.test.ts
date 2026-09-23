/**
 * The whole chain over real HTTP: intake → figure-mock → chase → Email Service.
 * Each service runs its production composition root on an ephemeral port; intake uses
 * PGlite with the real migrations. The Email Service lives in its own repository
 * (heloc-email-service), so it is stood in for by a stub that speaks its Send API
 * contract — validating every request, honouring idempotency keys as the real one does.
 */
import { Writable } from 'node:stream';
import { PGlite } from '@electric-sql/pglite';
import { chaseEnv, figureMockEnv, intakeEnv, loadConfig } from '@heloc/config';
import {
  HEADERS,
  leadResultSchema,
  sendEmailRequestSchema,
  type LeadResult,
  type SendEmailRequest,
} from '@heloc/contracts';
import { createLogger } from '@heloc/logger';
import { bearerAuth, createServer, HttpError, parseInput } from '@heloc/server-kit';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp as buildChase } from '../../apps/chase/src/app.ts';
import { buildApp as buildFigure } from '../../apps/figure-mock/src/app.ts';
import { buildApp as buildIntake } from '../../apps/intake/src/app.ts';
import {
  DrizzleLeadRepository,
  type Database,
} from '../../apps/intake/src/infrastructure/db/drizzle-lead-repository.ts';
import * as schema from '../../apps/intake/src/infrastructure/db/schema.ts';

const silent = new Writable({ write: (_c, _e, cb) => cb() });
const logger = () => createLogger({ service: 'e2e', destination: silent }).logger;
const keys = {
  figure: 'f'.repeat(64),
  chase: 'c'.repeat(64),
  email: 'e'.repeat(64),
  inbound: 'i'.repeat(64),
};

/** Stands in for heloc-email-service: POST /v1/send per its contract. */
class StubEmailService {
  readonly delivered = new Map<string, { email: SendEmailRequest }>();
  /** Answers like the real service when its provider (Resend) fails. */
  down = false;

  build() {
    const app = createServer({ service: 'email', version: 'e2e', logger: logger() });
    app.register(
      async (v1) => {
        v1.addHook('onRequest', bearerAuth(keys.email));
        v1.post('/send', async (request, reply) => {
          const email = parseInput(sendEmailRequestSchema, request.body);
          if (this.down) throw new HttpError(502, 'provider_error', 'resend: unavailable');
          const key = String(request.headers[HEADERS.idempotencyKey] ?? crypto.randomUUID());
          if (!this.delivered.has(key)) this.delivered.set(key, { email });
          const messageId = `email_${[...this.delivered.keys()].indexOf(key) + 1}`;
          return reply.code(202).send({ message_id: messageId, status: 'accepted' });
        });
      },
      { prefix: '/v1' },
    );
    return app;
  }
}

const provider = new StubEmailService();
const servers: { close(): Promise<unknown> }[] = [];
let intakeUrl = '';
let background: Promise<unknown>[] = [];

async function listen(app: ReturnType<typeof buildFigure>) {
  servers.push(app);
  return app.listen({ host: '127.0.0.1', port: 0 });
}

beforeAll(async () => {
  const emailUrl = await listen(provider.build());
  const chaseUrl = await listen(
    buildChase({
      config: loadConfig(chaseEnv, {
        INTERNAL_API_KEY: keys.chase,
        EMAIL_SERVICE_URL: emailUrl,
        EMAIL_SERVICE_API_KEY: keys.email,
        CHASE_REPLY_ADDRESS: 'reply@linkerclaw.ai',
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
        WEB_APP_URL: 'https://heloc-demo.vercel.app',
        INBOUND_API_KEY: keys.inbound,
        OPS_API_KEY: 'o'.repeat(64),
      }),
      logger: logger(),
      version: 'e2e',
      store: new DrizzleLeadRepository(db),
      pingDatabase: async () => {},
      onBackground: (work) => background.push(work),
    }),
  );
});

afterAll(async () => {
  await Promise.all(servers.map((s) => s.close()));
});

let borrowers = 0;
beforeEach(() => {
  provider.delivered.clear();
  provider.down = false;
  // One Open Lead per email (ADR-0007): each test is a different borrower.
  quiz.email = `user+${++borrowers}@linkerclaw.ai`;
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
    expect(sent.email).toMatchObject({
      to: quiz.email,
      subject: 'Additional documents required for your HELOC application',
    });
    expect(sent.email.text).toContain('Hi John,');
    expect(sent.email.text).toContain('- Proof of income');
  });

  it.each([
    ['approved', 'approved'],
    ['rejected', 'rejected'],
  ])(
    'X-Mock-Outcome %s reaches Figure, ends %s and emails the result page',
    async (outcome, status) => {
      const { body } = await post('/v1/leads', quiz, { 'x-mock-outcome': outcome });
      expect(body).toMatchObject({ status, notice: { status: 'sent' } });

      expect(provider.delivered.size).toBe(1);
      const [key, sent] = [...provider.delivered][0]!;
      expect(key).toMatch(/^notice:[0-9a-f-]{36}$/);
      expect(sent.email.to).toBe(quiz.email);
      expect(sent.email.text).not.toContain('documents');
      expect(sent.email.text).toContain(`https://heloc-demo.vercel.app/result/${body.lead_id}`);
      if (status === 'approved') {
        expect(sent.email.subject).toBe('Your HELOC offer is ready');
        expect(sent.email.html).toContain('>View your offer</a>');
      }
    },
  );

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

describe('borrower replies with documents (ADR-0004)', () => {
  it('reply → document review → outcome notice, with the reply address set on the chase email', async () => {
    const created = await post('/v1/leads', quiz);
    expect(created.body.status).toBe('chase_sent');
    const replyTo = created.body.chase!.reply_to!;
    expect(replyTo).toMatch(/^reply\+[0-9a-f-]{36}@linkerclaw\.ai$/);

    // The chase email carried that Reply-To all the way to the provider.
    const [chaseEmail] = [...provider.delivered.values()];
    expect(chaseEmail?.email.reply_to).toBe(replyTo);
    expect(chaseEmail?.email.text).toContain('reply to this email');

    // What the Cloudflare Email Worker posts when the borrower replies.
    background = [];
    const res = await fetch(`${intakeUrl}/v1/inbound-emails`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${keys.inbound}` },
      body: JSON.stringify({
        message_id: '<borrower-reply@mail.example.com>',
        received_at: new Date().toISOString(),
        from: quiz.email,
        to: replyTo,
        subject: 'Re: Additional documents required for your HELOC application',
        authentication: { dmarc: 'pass', detail: 'mx.cloudflare.net; dmarc=pass' },
        attachments: [
          {
            filename: 'paystub.pdf',
            content_type: 'application/pdf',
            size: 2048,
            sha256: 'c'.repeat(64),
          },
        ],
      }),
    });
    expect(await res.json()).toMatchObject({ accepted: true });
    await Promise.all(background);

    const leadRes = await fetch(`${intakeUrl}/v1/leads/${created.body.lead_id}`);
    const lead = leadResultSchema.parse(await leadRes.json());
    expect(lead).toMatchObject({ status: 'approved', notice: { status: 'sent' } });
    expect(eventTypes(lead).slice(-5)).toEqual([
      'documents.received',
      'figure.review_requested',
      'figure.review_approved',
      'notice.created',
      'notice.sent',
    ]);

    // Two emails in total: the chase, then the outcome notice (keyed by notice id).
    const keysSent = [...provider.delivered.keys()];
    expect(keysSent).toHaveLength(2);
    expect(keysSent[1]).toMatch(/^notice:/);
    const notice = provider.delivered.get(keysSent[1]!)!;
    expect(notice.email).toMatchObject({
      to: quiz.email,
      subject: 'Your HELOC offer is ready',
    });
    expect(notice.email.text).toContain(
      `https://heloc-demo.vercel.app/result/${created.body.lead_id}`,
    );
  });
});
