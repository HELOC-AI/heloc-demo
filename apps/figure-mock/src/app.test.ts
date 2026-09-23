import { Writable } from 'node:stream';
import { figureMockEnv, loadConfig } from '@heloc/config';
import { createLogger } from '@heloc/logger';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from './app.ts';

const silent = new Writable({ write: (_c, _e, cb) => cb() });
const key = 'k'.repeat(64);
const ENV = { INTERNAL_API_KEY: key };
let app: ReturnType<typeof buildApp>;

function build() {
  const config = loadConfig(figureMockEnv, ENV);
  app = buildApp({
    config,
    logger: createLogger({ service: 'test', destination: silent }).logger,
    version: 'test',
  });
  return app;
}

afterEach(() => app?.close());

describe('figure-mock', () => {
  it('serves /health', async () => {
    const res = await build().inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'ok', service: 'figure-mock' });
  });
});
