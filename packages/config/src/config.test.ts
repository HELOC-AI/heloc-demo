import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from './load.ts';
import { emailEnv, intakeEnv, serviceVersion } from './services.ts';

const key = 'k'.repeat(64);
const intakeVars = {
  DATABASE_URL:
    'postgresql://postgres.ref:secret-pw@aws-0-us-east-1.pooler.supabase.com:5432/postgres',
  FIGURE_API_URL: 'https://figure.example.com/',
  FIGURE_API_KEY: key,
  CHASE_API_URL: 'https://chase.example.com',
  CHASE_API_KEY: key,
  CORS_ORIGINS: 'https://heloc-demo.vercel.app/, http://localhost:3000',
  WEB_APP_URL: 'https://heloc-demo.vercel.app',
  INBOUND_API_KEY: key,
};

describe('loadConfig', () => {
  it('parses and applies defaults', () => {
    const config = loadConfig(intakeEnv, intakeVars);
    expect(config.PORT).toBe(3000);
    expect(config.HOST).toBe('::');
    expect(config.FIGURE_API_URL).toBe('https://figure.example.com');
    expect(config.CORS_ORIGINS).toEqual(['https://heloc-demo.vercel.app', 'http://localhost:3000']);
    expect(config.ALLOW_MOCK_OVERRIDE).toBe(false);
  });

  it('parses "false" as false, not truthy', () => {
    expect(
      loadConfig(intakeEnv, { ...intakeVars, ALLOW_MOCK_OVERRIDE: 'false' }).ALLOW_MOCK_OVERRIDE,
    ).toBe(false);
    expect(
      loadConfig(intakeEnv, { ...intakeVars, ALLOW_MOCK_OVERRIDE: 'true' }).ALLOW_MOCK_OVERRIDE,
    ).toBe(true);
  });

  it('treats empty strings as unset', () => {
    expect(loadConfig(intakeEnv, { ...intakeVars, PORT: '' }).PORT).toBe(3000);
  });

  it('reports every problem by name without echoing values', () => {
    const vars = { ...intakeVars, CHASE_API_KEY: 'short-secret', DATABASE_URL: undefined };
    let error: unknown;
    try {
      loadConfig(intakeEnv, vars);
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(ConfigError);
    const message = (error as ConfigError).message;
    expect(message).toContain('DATABASE_URL: required');
    expect(message).toContain('CHASE_API_KEY: must be at least 32 characters');
    expect(message).not.toContain('short-secret');
  });

  it('requires RESEND_API_KEY only for the resend provider', () => {
    const vars = { INTERNAL_API_KEY: key, EMAIL_FROM: 'HELOC <noreply@example.com>' };
    expect(() => loadConfig(emailEnv, vars)).toThrow(/RESEND_API_KEY: required when/);
    expect(loadConfig(emailEnv, { ...vars, EMAIL_PROVIDER: 'console' }).EMAIL_PROVIDER).toBe(
      'console',
    );
  });
});

describe('serviceVersion', () => {
  it('uses the short commit sha when deployed', () => {
    expect(serviceVersion({ RAILWAY_GIT_COMMIT_SHA: 'abcdef1234567' })).toBe('abcdef1');
    expect(serviceVersion({})).toBe('dev');
  });
});
