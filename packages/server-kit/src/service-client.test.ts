import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import { z } from 'zod';
import { createServiceClient, UpstreamError } from './service-client.ts';

const server = Fastify();
let baseUrl = '';
const seen: Record<string, unknown>[] = [];

beforeAll(async () => {
  server.post('/ok', async (req) => {
    seen.push({ headers: req.headers, body: req.body });
    return { value: 42 };
  });
  server.post('/slow', async () => new Promise((r) => setTimeout(() => r({ value: 1 }), 200)));
  server.post('/fail', async (_req, reply) => reply.code(503).send({ error: 'down' }));
  server.post('/wrong-shape', async () => ({ other: true }));
  baseUrl = await server.listen({ host: '127.0.0.1', port: 0 });
});
afterAll(() => server.close());

const schema = z.object({ value: z.number() });
const client = (timeoutMs = 1000) =>
  createServiceClient({ service: 'test-upstream', baseUrl, apiKey: 'secret', timeoutMs });

async function failure(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (err) {
    return err as UpstreamError;
  }
  throw new Error('expected failure');
}

describe('createServiceClient', () => {
  it('sends auth, request id and extra headers, and parses the response', async () => {
    const result = await client().post(
      '/ok',
      { a: 1 },
      {
        responseSchema: schema,
        requestId: 'req-1',
        headers: { 'x-mock-outcome': 'approved', 'x-skip': undefined },
      },
    );
    expect(result).toEqual({ value: 42 });
    expect(seen[0]).toMatchObject({
      body: { a: 1 },
      headers: {
        authorization: 'Bearer secret',
        'x-request-id': 'req-1',
        'x-mock-outcome': 'approved',
      },
    });
    expect(seen[0]?.headers).not.toHaveProperty('x-skip');
  });

  it.each([
    ['/slow', 'timeout', undefined],
    ['/fail', 'http', 503],
    ['/wrong-shape', 'invalid_response', undefined],
  ] as const)('classifies %s as %s', async (path, kind, status) => {
    const err = await failure(client(50).post(path, {}, { responseSchema: schema }));
    expect(err).toBeInstanceOf(UpstreamError);
    expect(err.kind).toBe(kind);
    expect(err.status).toBe(status);
    expect(err.service).toBe('test-upstream');
  });

  it('classifies connection failures as network errors', async () => {
    const dead = createServiceClient({
      service: 'x',
      baseUrl: 'http://127.0.0.1:1',
      apiKey: 'k',
      timeoutMs: 1000,
    });
    expect((await failure(dead.post('/ok', {}, { responseSchema: schema }))).kind).toBe('network');
  });
});
