import { Writable } from 'node:stream';
import { createLogger } from '@heloc/logger';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { parseInput } from './errors.ts';
import { bearerAuth, createServer, type ServerOptions } from './server.ts';

const silent = new Writable({ write: (_c, _e, cb) => cb() });
const KEY = 'k'.repeat(64);
let app: ReturnType<typeof createServer>;

function build(overrides: Partial<ServerOptions> = {}) {
  app = createServer({
    service: 'test-service',
    version: 'abc1234',
    logger: createLogger({ service: 'test-service', destination: silent }).logger,
    ...overrides,
  });
  app.register(
    async (v1) => {
      v1.addHook('onRequest', bearerAuth(KEY));
      v1.post('/echo', async (req) => parseInput(z.object({ n: z.number() }), req.body));
      v1.get('/boom', async () => {
        throw new Error('kaboom');
      });
    },
    { prefix: '/v1' },
  );
  return app;
}

afterEach(() => app?.close());

describe('GET /health', () => {
  it('returns the spec shape without auth', async () => {
    const res = await build().inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'ok', service: 'test-service', version: 'abc1234' });
    expect(Date.parse(res.json().timestamp)).not.toBeNaN();
  });

  it('reports failing dependencies as degraded with 503', async () => {
    const res = await build({
      healthChecks: { db: async () => Promise.reject(new Error('down')), cache: async () => 1 },
    }).inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ status: 'degraded', checks: { db: 'fail', cache: 'ok' } });
  });

  it('treats a hanging dependency as failed', async () => {
    const res = await build({
      healthCheckTimeoutMs: 20,
      healthChecks: { db: () => new Promise(() => {}) },
    }).inject({ method: 'GET', url: '/health' });
    expect(res.json().checks).toEqual({ db: 'fail' });
  });
});

describe('bearerAuth', () => {
  it.each([undefined, 'Bearer wrong', `Basic ${KEY}`])('rejects %s', async (authorization) => {
    const res = await build().inject({
      method: 'POST',
      url: '/v1/echo',
      headers: authorization ? { authorization } : {},
      payload: { n: 1 },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toBe('unauthorized');
  });

  it('accepts the right key', async () => {
    const res = await build().inject({
      method: 'POST',
      url: '/v1/echo',
      headers: { authorization: `Bearer ${KEY}` },
      payload: { n: 1 },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ n: 1 });
  });
});

describe('errors and request ids', () => {
  const auth = { authorization: `Bearer ${KEY}` };

  it('maps validation failures to 400 with field details', async () => {
    const res = await build().inject({
      method: 'POST',
      url: '/v1/echo',
      headers: auth,
      payload: { n: 'x' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'invalid_request', details: [{ path: 'n' }] });
  });

  it('hides internal errors behind a 500', async () => {
    const res = await build().inject({ method: 'GET', url: '/v1/boom', headers: auth });
    expect(res.statusCode).toBe(500);
    expect(res.json()).toMatchObject({ error: 'internal_error' });
    expect(res.body).not.toContain('kaboom');
  });

  it('propagates a caller request id and generates one otherwise', async () => {
    build();
    const echoed = await app.inject({
      method: 'GET',
      url: '/health',
      headers: { 'x-request-id': 'req-123' },
    });
    expect(echoed.headers['x-request-id']).toBe('req-123');
    const generated = await app.inject({ method: 'GET', url: '/health' });
    expect(generated.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('refuses to reuse a malformed request id', async () => {
    const res = await build().inject({
      method: 'GET',
      url: '/health',
      headers: { 'x-request-id': 'a b<script>' },
    });
    expect(res.headers['x-request-id']).not.toBe('a b<script>');
  });

  it('returns JSON 404s', async () => {
    const res = await build().inject({ method: 'GET', url: '/nope' });
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe('not_found');
  });
});
