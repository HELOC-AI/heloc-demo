import { Writable } from 'node:stream';
import { emailEnv, loadConfig } from '@heloc/config';
import { createLogger } from '@heloc/logger';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from './app.ts';

const silent = new Writable({ write: (_c, _e, cb) => cb() });
const key = 'k'.repeat(64);
const ENV = {
  INTERNAL_API_KEY: key,
  EMAIL_PROVIDER: 'console',
  EMAIL_FROM: 'Test <test@example.com>',
};
let app: ReturnType<typeof buildApp>;

function build() {
  const config = loadConfig(emailEnv, ENV);
  app = buildApp({
    config,
    logger: createLogger({ service: 'test', destination: silent }).logger,
    version: 'test',
  });
  return app;
}

afterEach(() => app?.close());

describe('email', () => {
  it('serves /health', async () => {
    const res = await build().inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'ok', service: 'email' });
  });
});
