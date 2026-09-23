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
  // Injected by Railway; used as the /health version.
  RAILWAY_GIT_COMMIT_SHA: z.string().optional(),
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
});
export type ChaseConfig = z.output<typeof chaseEnv>;

export const emailEnv = base
  .extend({
    INTERNAL_API_KEY: apiKey,
    // `console` logs instead of sending; for local dev without a Resend key.
    EMAIL_PROVIDER: z.enum(['resend', 'console']).default('resend'),
    RESEND_API_KEY: z.string().startsWith('re_').optional(),
    EMAIL_FROM: z.string().min(3),
  })
  .refine((env) => env.EMAIL_PROVIDER !== 'resend' || env.RESEND_API_KEY, {
    path: ['RESEND_API_KEY'],
    message: 'required when EMAIL_PROVIDER=resend',
  });
export type EmailConfig = z.output<typeof emailEnv>;

export const serviceEnvSchemas = {
  intake: intakeEnv,
  'figure-mock': figureMockEnv,
  chase: chaseEnv,
  email: emailEnv,
} as const;

/** Version string for /health: short commit SHA on Railway, "dev" locally. */
export const serviceVersion = (config: { RAILWAY_GIT_COMMIT_SHA?: string | undefined }) =>
  config.RAILWAY_GIT_COMMIT_SHA?.slice(0, 7) ?? 'dev';
