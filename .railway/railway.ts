/**
 * Railway infrastructure for heloc-demo (Railway IaC).
 *
 *   railway config plan    preview changes
 *   railway config apply   apply to the linked project
 *
 * Secrets are declared with preserve(): the variable is part of the service's contract,
 * but its value never enters git. Values are pushed from the repo-root .env with
 * `node scripts/env-sync.ts --railway`. Everything else — non-secret config and the
 * cross-service wiring — is declared here. See docs/CONFIGURATION.md.
 */
import { defineRailway, github, preserve, project, service } from 'railway/iac';

const REPO = 'HELOC-AI/heloc-demo';
// Virginia (iad): closest Railway region to the Supabase project (us-east-2).
const REGION = 'iad';
const WEB_ORIGIN = 'https://heloc-demo.vercel.app';

/** Shared build/deploy shape: pnpm workspace at repo root, TypeScript run natively by Node. */
function app(name: string, domain: string, options: { preDeploy?: string } = {}) {
  return {
    source: github(REPO, { branch: 'main' }),
    build: {
      builder: 'RAILPACK' as const,
      buildCommand: `pnpm --filter @heloc/${name}... --if-present run build`,
      watchPatterns: [`/apps/${name}/**`, '/packages/**', '/pnpm-lock.yaml', '/.node-version'],
    },
    deploy: {
      startCommand: `node apps/${name}/src/main.ts`,
      ...(options.preDeploy && { preDeployCommand: [options.preDeploy] }),
      healthcheckPath: '/health',
      healthcheckTimeout: 60,
      restartPolicyType: 'ON_FAILURE' as const,
      restartPolicyMaxRetries: 5,
    },
    // Railway places new services in sfo; move the single replica next to the database.
    regions: { [REGION]: 1 },
    networking: { serviceDomains: { [domain]: {} } },
  };
}

const betterStack = {
  BETTERSTACK_SOURCE_TOKEN: preserve(),
  BETTERSTACK_INGESTING_HOST: preserve(),
  BETTERSTACK_ERRORS_DSN: preserve(),
};

export default defineRailway(() => {
  const email = service('email', {
    ...app('email', 'email-production-48c5.up.railway.app'),
    env: {
      ...betterStack,
      INTERNAL_API_KEY: preserve(),
      RESEND_API_KEY: preserve(),
      EMAIL_PROVIDER: 'resend',
      EMAIL_FROM: 'HELOC Demo <noreply@linkerclaw.ai>',
    },
  });

  const chase = service('chase', {
    ...app('chase', 'chase-production-4070.up.railway.app'),
    env: {
      ...betterStack,
      INTERNAL_API_KEY: preserve(),
      EMAIL_SERVICE_URL: 'https://${{email.RAILWAY_PUBLIC_DOMAIN}}',
      EMAIL_SERVICE_API_KEY: email.env.INTERNAL_API_KEY,
      // Replies land on Cloudflare Email Routing → Email Worker → intake (ADR-0004).
      CHASE_REPLY_ADDRESS: 'reply@linkerclaw.ai',
    },
  });

  const figureMock = service('figure-mock', {
    ...app('figure-mock', 'figure-mock-production.up.railway.app'),
    env: {
      ...betterStack,
      INTERNAL_API_KEY: preserve(),
      MOCK_MODE: 'deterministic',
    },
  });

  const intake = service('intake', {
    ...app('intake', 'intake-production-12aa.up.railway.app', {
      // Apply drizzle/ migrations before the new version takes traffic.
      preDeploy: 'node apps/intake/scripts/migrate.ts',
    }),
    env: {
      ...betterStack,
      DATABASE_URL: preserve(),
      FIGURE_API_URL: 'https://${{figure-mock.RAILWAY_PUBLIC_DOMAIN}}',
      FIGURE_API_KEY: figureMock.env.INTERNAL_API_KEY,
      CHASE_API_URL: 'https://${{chase.RAILWAY_PUBLIC_DOMAIN}}',
      CHASE_API_KEY: chase.env.INTERNAL_API_KEY,
      CORS_ORIGINS: WEB_ORIGIN,
      // Demo only: lets the quiz force a Figure outcome via X-Mock-Outcome.
      ALLOW_MOCK_OVERRIDE: 'true',
      WEB_APP_URL: WEB_ORIGIN,
      // Held by the Cloudflare Email Worker (apps/email-inbound) to post Chase Replies.
      INBOUND_API_KEY: preserve(),
      // Held by the /ops page server (Vercel) and scripts/ops.ts for GET /v1/ops/*.
      OPS_API_KEY: preserve(),
    },
  });

  return project('heloc-demo', {
    resources: [intake, figureMock, chase, email],
  });
});
