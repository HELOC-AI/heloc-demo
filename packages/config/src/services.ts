import { z } from 'zod';

/**
 * One schema per deployable service. Each schema is the authoritative list of what that
 * service may read from its environment — see docs/CONFIGURATION.md §2.
 * Keep apps/<service>/.env.example in sync (enforced by `pnpm check:env`).
 */

const url = z.url({ protocol: /^https?$/ }).transform((u) => u.replace(/\/+$/, ''));
const apiKey = z.string().min(32, 'must be at least 32 characters (openssl rand -hex 32)');

/** Variables every backend service understands. */
const base = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  // `::` binds IPv4 + IPv6, which Railway private networking needs.
  HOST: z.string().default('::'),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
  LOG_PRETTY: z.stringbool().default(false),
  // Injected by Railway; used as the /health version and error-report environment.
  RAILWAY_GIT_COMMIT_SHA: z.string().optional(),
  RAILWAY_ENVIRONMENT_NAME: z.string().optional(),
  // Better Stack. All optional so local dev works without them.
  BETTERSTACK_SOURCE_TOKEN: z.string().optional(),
  BETTERSTACK_INGESTING_HOST: z.string().optional(),
  BETTERSTACK_ERRORS_DSN: z.url().optional(),
});

export const intakeEnv = base.extend({
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  FIGURE_API_URL: url,
  FIGURE_API_KEY: apiKey,
  CHASE_API_URL: url,
  CHASE_API_KEY: apiKey,
  CORS_ORIGINS: z
    .string()
    .transform((s) => s.split(',').map((o) => o.trim().replace(/\/+$/, '')))
    .pipe(z.array(z.url()).min(1)),
  // Lets the web quiz force an outcome via X-Mock-Outcome. Never enable against a real Figure.
  ALLOW_MOCK_OVERRIDE: z.stringbool().default(false),
  /** Public web app; the Outcome Notice links to `${WEB_APP_URL}/result/<lead id>`. */
  WEB_APP_URL: url,
  /** Held by the inbound email adapter (Cloudflare Email Worker) to post Chase Replies. */
  INBOUND_API_KEY: apiKey,
  /** Held by operator tooling (the /ops page server, scripts/ops.ts) for GET /v1/ops/*. */
  OPS_API_KEY: apiKey,
});
export type IntakeConfig = z.output<typeof intakeEnv>;

export const figureMockEnv = base.extend({
  INTERNAL_API_KEY: apiKey,
  MOCK_MODE: z.enum(['deterministic']).default('deterministic'),
});
export type FigureMockConfig = z.output<typeof figureMockEnv>;

export const chaseEnv = base.extend({
  INTERNAL_API_KEY: apiKey,
  EMAIL_SERVICE_URL: url,
  EMAIL_SERVICE_API_KEY: apiKey,
  /** Base reply address; each Chase replies to `reply+<chase_id>@…` (Cloudflare Email Routing). */
  CHASE_REPLY_ADDRESS: z.email(),
});
export type ChaseConfig = z.output<typeof chaseEnv>;

export const serviceEnvSchemas = {
  intake: intakeEnv,
  'figure-mock': figureMockEnv,
  chase: chaseEnv,
} as const;

/** Version string for /health: short commit SHA on Railway, "dev" locally. */
export const serviceVersion = (config: { RAILWAY_GIT_COMMIT_SHA?: string | undefined }) =>
  config.RAILWAY_GIT_COMMIT_SHA?.slice(0, 7) ?? 'dev';
