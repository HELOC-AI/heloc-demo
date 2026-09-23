import { createServiceClient, UpstreamError } from '@heloc/server-kit';
import Fastify from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ChaseHttpGateway, OutcomeNoticeHttpGateway } from './chase-gateway.ts';
import { FigureHttpGateway } from './figure-gateway.ts';

const stub = Fastify();
const received: { url: string; headers: Record<string, unknown>; body: unknown }[] = [];
let figureReply: unknown;
let baseUrl = '';

beforeAll(async () => {
  stub.post('/v1/soft-pull', async (req) => {
    received.push({ url: req.url, headers: req.headers, body: req.body });
    return figureReply;
  });
  stub.post('/v1/chases', async (req) => {
    received.push({ url: req.url, headers: req.headers, body: req.body });
    return {
      chase_id: (req.body as { chase_id: string }).chase_id,
      status: 'sent',
      subject: 'Additional documents required for your HELOC application',
      body: 'Hi John',
      email_message_id: 'email_123',
      reply_to: `reply+${(req.body as { chase_id: string }).chase_id}@linkerclaw.ai`,
    };
  });
  stub.post('/v1/document-reviews', async (req) => {
    received.push({ url: req.url, headers: req.headers, body: req.body });
    return { status: 'rejected', reason: 'credit_below_minimum' };
  });
  stub.post('/v1/outcome-notices', async (req) => {
    received.push({ url: req.url, headers: req.headers, body: req.body });
    return {
      notice_id: (req.body as { notice_id: string }).notice_id,
      status: 'sent',
      subject: 'Your HELOC offer is ready',
      body: 'Hi John',
      email_message_id: 'email_456',
    };
  });
  baseUrl = await stub.listen({ host: '127.0.0.1', port: 0 });
});
afterAll(() => stub.close());
beforeEach(() => {
  received.length = 0;
});

const client = (service: string) =>
  createServiceClient({ service, baseUrl, apiKey: 'secret', timeoutMs: 2_000 });
const request = {
  leadId: '11111111-1111-4111-8111-111111111111',
  propertyState: 'CA',
  estimatedValue: 800_000,
  mortgageBalance: 350_000,
  creditBand: '700-739',
  incomeBand: '150k-200k',
};

describe('FigureHttpGateway (anti-corruption layer)', () => {
  const gateway = () => new FigureHttpGateway(client('figure-mock'));

  it('translates need-more-documents into Missing Documents', async () => {
    figureReply = {
      status: 'need-more-documents',
      documents: [{ type: 'income_verification', reason: 'Income requires verification' }],
    };
    const { decision, rawResponse } = await gateway().softPull(request, { requestId: 'req-1' });
    expect(decision).toEqual({
      outcome: 'need_more_documents',
      missingDocuments: [{ type: 'income_verification', reason: 'Income requires verification' }],
    });
    expect(rawResponse).toEqual(figureReply);
  });

  it('translates an approval into a domain Offer', async () => {
    figureReply = {
      status: 'approved',
      offer: {
        lender: 'Figure mock',
        amount: 150_000,
        apr_min: 7.5,
        apr_max: 9.5,
        term_months: 120,
        estimated_monthly_payment: 1_780,
        expires_at: '2026-10-01T00:00:00.000Z',
      },
    };
    const { decision } = await gateway().softPull(request, {});
    expect(decision).toEqual({
      outcome: 'approved',
      offer: {
        lender: 'Figure mock',
        amount: 150_000,
        aprMin: 7.5,
        aprMax: 9.5,
        termMonths: 120,
        estimatedMonthlyPayment: 1_780,
        expiresAt: new Date('2026-10-01T00:00:00.000Z'),
      },
    });
  });

  it("sends Figure's request shape, the request id and the demo scenario in Figure's words", async () => {
    figureReply = { status: 'rejected', reason: 'insufficient_home_equity' };
    await gateway().softPull(request, {
      requestId: 'req-1',
      scenario: { forcedOutcome: 'need_more_documents', fault: 'timeout' },
    });
    expect(received[0]).toMatchObject({
      body: { lead_id: request.leadId, estimated_home_value: 800_000, credit_band: '700-739' },
      headers: {
        authorization: 'Bearer secret',
        'x-request-id': 'req-1',
        'x-mock-outcome': 'need-more-documents',
        'x-mock-fault': 'timeout',
      },
    });
  });

  it('fails loudly on a response outside the contract', async () => {
    figureReply = { status: 'maybe' };
    await expect(gateway().softPull(request, {})).rejects.toBeInstanceOf(UpstreamError);
  });
});

describe('ChaseHttpGateway', () => {
  it('sends the Chase and returns the delivery', async () => {
    const now = new Date('2026-09-23T00:00:00Z');
    const gateway = new ChaseHttpGateway(client('chase'), { now: () => now });
    const delivery = await gateway.send(
      {
        chaseId: '22222222-2222-4222-8222-222222222222',
        leadId: request.leadId,
        borrowerName: 'John Doe',
        borrowerEmail: 'john@example.com',
        missingDocuments: [{ type: 'income_verification', reason: 'Income requires verification' }],
      },
      { requestId: 'req-2' },
    );
    expect(delivery).toEqual({
      subject: 'Additional documents required for your HELOC application',
      body: 'Hi John',
      emailMessageId: 'email_123',
      replyTo: 'reply+22222222-2222-4222-8222-222222222222@linkerclaw.ai',
      sentAt: now,
    });
    expect(received[0]?.body).toEqual({
      chase_id: '22222222-2222-4222-8222-222222222222',
      lead_id: request.leadId,
      email: 'john@example.com',
      name: 'John Doe',
      missing_documents: [{ type: 'income_verification', reason: 'Income requires verification' }],
    });
  });
});

describe('FigureHttpGateway.reviewDocuments', () => {
  it("sends documents and attachment metadata, and translates Figure's verdict", async () => {
    const gateway = new FigureHttpGateway(client('figure-mock'));
    const { decision } = await gateway.reviewDocuments(
      {
        ...request,
        documents: [{ type: 'income_verification', reason: 'Income requires verification' }],
        attachments: [{ filename: 'paystub.pdf', contentType: 'application/pdf', size: 99 }],
      },
      { requestId: 'req-3' },
    );
    expect(decision).toEqual({ outcome: 'rejected', reason: 'credit_below_minimum' });
    expect(received[0]).toMatchObject({
      url: '/v1/document-reviews',
      body: {
        lead_id: request.leadId,
        documents: [{ type: 'income_verification' }],
        attachments: [{ filename: 'paystub.pdf', content_type: 'application/pdf', size: 99 }],
      },
    });
  });
});

describe('OutcomeNoticeHttpGateway', () => {
  it('sends the review outcome in the contract shape', async () => {
    const now = new Date('2026-09-23T00:00:00Z');
    const gateway = new OutcomeNoticeHttpGateway(client('chase'), { now: () => now });
    const delivery = await gateway.sendNotice(
      {
        noticeId: '44444444-4444-4444-8444-444444444444',
        leadId: request.leadId,
        borrowerName: 'John Doe',
        borrowerEmail: 'john@example.com',
        outcome: {
          outcome: 'approved',
          offer: {
            lender: 'Figure mock',
            amount: 250_000,
            aprMin: 7.5,
            aprMax: 9.5,
            termMonths: 120,
            estimatedMonthlyPayment: 2_968,
            expiresAt: new Date('2026-10-23T00:00:00Z'),
          },
        },
        resultUrl: 'https://heloc-demo.vercel.app/result/x',
      },
      {},
    );
    expect(delivery).toEqual({
      subject: 'Your HELOC offer is ready',
      body: 'Hi John',
      emailMessageId: 'email_456',
      sentAt: now,
    });
    expect(received[0]?.body).toMatchObject({
      notice_id: '44444444-4444-4444-8444-444444444444',
      outcome: {
        status: 'approved',
        offer: { amount: 250_000, expires_at: '2026-10-23T00:00:00.000Z' },
      },
      result_url: 'https://heloc-demo.vercel.app/result/x',
    });
  });
});
